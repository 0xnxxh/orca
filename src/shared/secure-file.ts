import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  SecurePathHardeningCache,
  type SecurePathHardeningCacheBounds
} from './secure-path-hardening-cache'
import {
  type HardenedPathCacheEntry,
  hardenedPathCacheEntriesMatch,
  toHardenedPathCacheEntry
} from './secure-path-hardening-snapshot'
import {
  bestEffortRestrictWindowsPath,
  resetSecureFileWindowsUserSidForTests,
  restrictWindowsPathSync
} from './secure-path-windows-acl'

export const SECURE_PATH_HARDENING_CACHE_MAX_ENTRIES = 1024
export const SECURE_PATH_HARDENING_CACHE_KEY_MAX_BYTES = 64 * 1024
export const SECURE_PATH_HARDENING_CACHE_KEYS_MAX_BYTES = 512 * 1024

const DEFAULT_HARDENING_CACHE_BOUNDS: SecurePathHardeningCacheBounds = {
  maxEntries: SECURE_PATH_HARDENING_CACHE_MAX_ENTRIES,
  maxKeyBytes: SECURE_PATH_HARDENING_CACHE_KEY_MAX_BYTES,
  maxTotalKeyBytes: SECURE_PATH_HARDENING_CACHE_KEYS_MAX_BYTES
}

// Why: PowerShell hardening (~1-1.5s) stalls the main thread, so cache idempotent re-hardens per process.
let hardenedPathsThisProcess = new SecurePathHardeningCache<HardenedPathCacheEntry>(
  DEFAULT_HARDENING_CACHE_BOUNDS
)

// Why: child writes constantly bump a dir's mtime, so cache dirs by path (not metadata) to avoid a PowerShell spawn every read (#4901).
// Limitation: a dir deleted+recreated in-process won't re-harden; fine since we never delete our secure dirs at runtime.
let hardenedDirectoryPathsThisProcess = new SecurePathHardeningCache<true>(
  DEFAULT_HARDENING_CACHE_BOUNDS
)

function hardenSecureDirectoryOnce(dirPath: string): void {
  // Why: dir hardening stays async — re-applying it stormed the main thread (#4901); files inside are hardened synchronously anyway.
  if (hardenedDirectoryPathsThisProcess.get(dirPath)) {
    return
  }
  applySecurePathRestriction(dirPath, true, process.platform, false)
  // Cache even though the async ACL may still be in flight — dir restriction is best-effort, no retry.
  hardenedDirectoryPathsThisProcess.set(dirPath, true)
}

function hardenSecurePathOnce(targetPath: string, isDirectory: boolean): boolean {
  if (isDirectory && process.platform === 'win32') {
    hardenSecureDirectoryOnce(targetPath)
    return true
  }

  const currentEntry = getHardenedPathCacheEntry(targetPath, isDirectory)
  if (!currentEntry) {
    hardenedPathsThisProcess.delete(targetPath)
  }
  const cachedEntry = hardenedPathsThisProcess.get(targetPath)
  if (currentEntry && cachedEntry && hardenedPathCacheEntriesMatch(currentEntry, cachedEntry)) {
    return true
  }
  // Why: async re-harden is safe here — read path hardens each file at most once/process; new files harden synchronously on the write path.
  if (applySecurePathRestriction(targetPath, isDirectory, process.platform, false)) {
    rememberHardenedPath(targetPath, isDirectory)
    return true
  }
  return false
}

export function writeSecureJsonFile(targetPath: string, value: unknown): void {
  writeSecureFile(targetPath, JSON.stringify(value, null, 2))
}

export function writeSecureFile(targetPath: string, contents: string): void {
  const dir = dirname(targetPath)
  // Why: recursive mkdir is idempotent, so the existsSync probe was a second syscall for nothing (worse on a stalled mount).
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  // Windows dir hardening stays async + path-cached (it stormed the main thread, #4901); POSIX keeps the metadata cache to catch chmod/ctime drift.
  hardenSecurePathOnce(dir, true)

  const tmpFile = `${targetPath}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`
  try {
    writeFileSync(tmpFile, contents, {
      encoding: 'utf-8',
      mode: 0o600
    })
    // Why: writeFileSync mode is a no-op on Windows, so restrict the credential's ACL synchronously before the rename publishes it under inherited ACLs.
    applySecurePathRestriction(tmpFile, false, process.platform, true)
    renameSync(tmpFile, targetPath)
    // Why: these hold auth credentials, so the published path must stay current-user only; cache only on confirmed success so failures retry.
    if (applySecurePathRestriction(targetPath, false, process.platform, true)) {
      rememberHardenedPath(targetPath, false)
    }
  } catch (error) {
    rmSync(tmpFile, { force: true })
    throw error
  }
}

export function hardenExistingSecureFile(targetPath: string): void {
  const dir = dirname(targetPath)
  if (existsSync(dir)) {
    hardenSecurePathOnce(dir, true)
  }
  if (existsSync(targetPath)) {
    hardenSecurePathOnce(targetPath, false)
  }
}

// Why: async twin so main-thread IPC callers never park the process on a stalled mount; the sync twin stays for CLI/startup callers that cannot await.

/**
 * Serializes every async mutation of a target path. The sync twin got ordering for free from
 * the single thread; without this chain two overlapping writes could rename out of order, and
 * a removal could unlink before an in-flight write's rename republished the file.
 */
const pendingSecureMutationsByPath = new Map<string, Promise<void>>()

export function writeSecureJsonFileAsync(targetPath: string, value: unknown): Promise<void> {
  return writeSecureFileAsync(targetPath, JSON.stringify(value, null, 2))
}

export function writeSecureFileAsync(targetPath: string, contents: string): Promise<void> {
  return chainSecureMutation(targetPath, () => performSecureWrite(targetPath, contents))
}

/** Removes a secure file in call order with writeSecureFileAsync, so a clear can't lose a race with a queued save. */
export function removeSecureFileAsync(targetPath: string): Promise<void> {
  return chainSecureMutation(targetPath, () => rm(targetPath, { force: true }))
}

function chainSecureMutation(targetPath: string, run: () => Promise<void>): Promise<void> {
  const previous = pendingSecureMutationsByPath.get(targetPath)
  const result = previous ? previous.then(run, run) : run()
  const settled: Promise<void> = result.then(
    () => undefined,
    () => undefined
  )
  pendingSecureMutationsByPath.set(targetPath, settled)
  void settled.then(() => {
    if (pendingSecureMutationsByPath.get(targetPath) === settled) {
      pendingSecureMutationsByPath.delete(targetPath)
    }
  })
  return result
}

async function performSecureWrite(targetPath: string, contents: string): Promise<void> {
  const dir = dirname(targetPath)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await hardenSecurePathOnceAsync(dir, true, false)

  const tmpFile = `${targetPath}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`
  try {
    // Why: mode on the CREATE (not a later chmod) is what keeps the credential from ever existing world-readable.
    await writeFile(tmpFile, contents, { encoding: 'utf-8', mode: 0o600 })
    // Why: writeFile mode is a no-op on Windows, so restrict the ACL before the rename publishes it under inherited ACLs.
    await applySecurePathRestrictionAsync(tmpFile, false, process.platform, true)
    await rename(tmpFile, targetPath)
    // Why: these hold auth credentials, so the published path must stay current-user only; cache only on confirmed success so failures retry.
    if (await applySecurePathRestrictionAsync(targetPath, false, process.platform, true)) {
      await rememberHardenedPathAsync(targetPath, false)
    }
  } catch (error) {
    await rm(tmpFile, { force: true })
    throw error
  }
}

export async function hardenExistingSecureFileAsync(targetPath: string): Promise<void> {
  // Why: one stat per path replaces the sync twin's access()+stat pair — half the syscalls on a mount that may never answer.
  await hardenSecurePathOnceAsync(dirname(targetPath), true, true)
  await hardenSecurePathOnceAsync(targetPath, false, true)
}

async function hardenSecurePathOnceAsync(
  targetPath: string,
  isDirectory: boolean,
  skipWhenMissing: boolean
): Promise<boolean> {
  if (isDirectory && process.platform === 'win32') {
    // Why: the win32 dir cache is path-keyed with no metadata check (#4901), so hardening a
    // path that isn't there would spawn PowerShell and then cache the miss forever. The sync
    // twin gates on existsSync; mirror that gate for the read-path callers that pass it.
    if (skipWhenMissing && !(await getHardenedPathCacheEntryAsync(targetPath, isDirectory))) {
      return false
    }
    hardenSecureDirectoryOnce(targetPath)
    return true
  }

  const currentEntry = await getHardenedPathCacheEntryAsync(targetPath, isDirectory)
  if (!currentEntry) {
    hardenedPathsThisProcess.delete(targetPath)
    if (skipWhenMissing) {
      return false
    }
  }
  const cachedEntry = hardenedPathsThisProcess.get(targetPath)
  if (currentEntry && cachedEntry && hardenedPathCacheEntriesMatch(currentEntry, cachedEntry)) {
    return true
  }
  if (await applySecurePathRestrictionAsync(targetPath, isDirectory, process.platform, false)) {
    await rememberHardenedPathAsync(targetPath, isDirectory)
    return true
  }
  return false
}

async function applySecurePathRestrictionAsync(
  targetPath: string,
  isDirectory: boolean,
  platform: NodeJS.Platform,
  sync: boolean
): Promise<boolean> {
  // Why: Windows hardening is a PowerShell spawn, not an fs syscall — out of the stalled-mount blast radius, so reuse it verbatim.
  if (platform === 'win32') {
    return applySecurePathRestriction(targetPath, isDirectory, platform, sync)
  }
  await chmod(targetPath, isDirectory ? 0o700 : 0o600)
  return true
}

async function rememberHardenedPathAsync(targetPath: string, isDirectory: boolean): Promise<void> {
  const entry = await getHardenedPathCacheEntryAsync(targetPath, isDirectory)
  if (entry) {
    hardenedPathsThisProcess.set(targetPath, entry)
  } else {
    hardenedPathsThisProcess.delete(targetPath)
  }
}

async function getHardenedPathCacheEntryAsync(
  targetPath: string,
  isDirectory: boolean
): Promise<HardenedPathCacheEntry | null> {
  try {
    return toHardenedPathCacheEntry(await stat(targetPath), isDirectory)
  } catch {
    return null
  }
}

/** Applies the platform-appropriate permission restriction to a path once, bypassing the cache. */
export function hardenSecurePath(
  targetPath: string,
  options: {
    isDirectory: boolean
    platform: NodeJS.Platform
    sync?: boolean
  }
): void {
  applySecurePathRestriction(
    targetPath,
    options.isDirectory,
    options.platform,
    options.sync ?? false
  )
}

/** Applies hardening; async Windows calls only report that best-effort ACL work was accepted. */
function applySecurePathRestriction(
  targetPath: string,
  isDirectory: boolean,
  platform: NodeJS.Platform,
  sync: boolean
): boolean {
  if (platform === 'win32') {
    if (sync) {
      // Why: apply the ACL synchronously so the credential file isn't briefly readable under inherited ACLs (writeFileSync mode is a no-op on Windows).
      return restrictWindowsPathSync(targetPath, isDirectory)
    }
    // Why: dir/read-path re-harden runs async to avoid blocking the main thread (#4901); return true optimistically since it's best-effort.
    bestEffortRestrictWindowsPath(targetPath, isDirectory)
    return true
  }
  chmodSync(targetPath, isDirectory ? 0o700 : 0o600)
  return true
}

/** Caches the current metadata snapshot for a just-hardened path, or clears it if the path is gone. */
function rememberHardenedPath(targetPath: string, isDirectory: boolean): void {
  const entry = getHardenedPathCacheEntry(targetPath, isDirectory)
  if (entry) {
    hardenedPathsThisProcess.set(targetPath, entry)
  } else {
    hardenedPathsThisProcess.delete(targetPath)
  }
}

function getHardenedPathCacheEntry(
  targetPath: string,
  isDirectory: boolean
): HardenedPathCacheEntry | null {
  try {
    return toHardenedPathCacheEntry(statSync(targetPath), isDirectory)
  } catch {
    return null
  }
}

export function __resetSecureFileWindowsUserSidForTests(): void {
  resetSecureFileWindowsUserSidForTests()
}

export function __resetSecureFileHardenedPathsForTests(
  bounds: SecurePathHardeningCacheBounds = DEFAULT_HARDENING_CACHE_BOUNDS
): void {
  hardenedPathsThisProcess = new SecurePathHardeningCache(bounds)
  hardenedDirectoryPathsThisProcess = new SecurePathHardeningCache(bounds)
}

export function __getSecureFileHardeningCacheStateForTests(): {
  paths: ReturnType<SecurePathHardeningCache<HardenedPathCacheEntry>['state']>
  directories: ReturnType<SecurePathHardeningCache<true>['state']>
} {
  return {
    paths: hardenedPathsThisProcess.state(),
    directories: hardenedDirectoryPathsThisProcess.state()
  }
}
