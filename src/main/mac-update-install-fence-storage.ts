import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  MAC_UPDATE_FENCE_MAX_BYTES,
  parseMacUpdateInstallFence,
  type MacUpdateFenceParseFailure,
  type MacUpdateInstallFence
} from '../shared/mac-update-install-fence'
import { writeSecureFile } from '../shared/secure-file'

const FENCE_DIRECTORY_COMPONENTS = ['Library', 'Application Support', 'com.stablyai.orca'] as const
const FENCE_FILENAME = 'orca-install-fence-v1.json'
const LOCK_FILENAME = 'orca-install-fence-v1.lock'
const DIAGNOSTIC_FILENAME = 'orca-install-fence-v1-diagnostics.json'
const LOCK_WAIT_MS = 250
const STALE_LOCK_MS = 30_000

export type MacUpdateFencePaths = {
  directoryPath: string
  fencePath: string
  lockPath: string
  diagnosticPath: string
}

export type MacUpdateFenceReadResult =
  | { kind: 'missing' }
  | { kind: 'valid'; fence: MacUpdateInstallFence }
  | { kind: 'invalid'; reason: MacUpdateFenceParseFailure }
  | { kind: 'unreadable' }

export class MacUpdateFenceAlreadyExistsError extends Error {
  constructor() {
    super('A macOS update install fence already exists')
  }
}

export function getMacUpdateFencePaths(userHome = homedir()): MacUpdateFencePaths {
  const directoryPath = join(userHome, ...FENCE_DIRECTORY_COMPONENTS)
  return {
    directoryPath,
    fencePath: join(directoryPath, FENCE_FILENAME),
    lockPath: join(directoryPath, LOCK_FILENAME),
    diagnosticPath: join(directoryPath, DIAGNOSTIC_FILENAME)
  }
}

export function getMacShipItStatePath(userHome = homedir()): string {
  return join(userHome, 'Library', 'Caches', 'com.stablyai.orca.ShipIt', 'ShipItState.plist')
}

export function readMacUpdateInstallFence(
  now = Date.now(),
  paths = getMacUpdateFencePaths()
): MacUpdateFenceReadResult {
  try {
    if (!existsSync(paths.fencePath)) {
      return { kind: 'missing' }
    }
    const stats = lstatSync(paths.fencePath)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return { kind: 'invalid', reason: 'malformed' }
    }
    if (stats.size > MAC_UPDATE_FENCE_MAX_BYTES) {
      return { kind: 'invalid', reason: 'malformed' }
    }
    const parsed = parseMacUpdateInstallFence(readFileSync(paths.fencePath, 'utf8'), now)
    return parsed.ok
      ? { kind: 'valid', fence: parsed.fence }
      : { kind: 'invalid', reason: parsed.reason }
  } catch {
    return { kind: 'unreadable' }
  }
}

export function createMacUpdateInstallFence(
  fence: MacUpdateInstallFence,
  paths = getMacUpdateFencePaths()
): void {
  ensureFenceDirectory(paths.directoryPath)
  withMacUpdateFenceLock(paths, () => {
    let descriptor: number | undefined
    try {
      descriptor = openSync(paths.fencePath, 'wx', 0o600)
      writeFileSync(descriptor, serializeFence(fence), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new MacUpdateFenceAlreadyExistsError()
      }
      throw error
    } finally {
      if (descriptor !== undefined) {
        closeSync(descriptor)
      }
    }
  })
}

export function updateMacUpdateInstallFence(
  attemptId: string,
  update: (fence: MacUpdateInstallFence) => MacUpdateInstallFence,
  paths = getMacUpdateFencePaths()
): boolean {
  return withMacUpdateFenceLock(paths, () => {
    const current = readMacUpdateInstallFence(Date.now(), paths)
    if (current.kind !== 'valid' || current.fence.attemptId !== attemptId) {
      return false
    }
    writeFenceAtomically(paths.fencePath, update(current.fence))
    return true
  })
}

export function removeMacUpdateInstallFence(
  attemptId: string,
  paths = getMacUpdateFencePaths()
): boolean {
  return withMacUpdateFenceLock(paths, () => {
    const current = readMacUpdateInstallFence(Date.now(), paths)
    if (current.kind !== 'valid' || current.fence.attemptId !== attemptId) {
      return false
    }
    rmSync(paths.fencePath, { force: true })
    return true
  })
}

export function removeInvalidMacUpdateInstallFence(paths = getMacUpdateFencePaths()): boolean {
  return withMacUpdateFenceLock(paths, () => {
    const current = readMacUpdateInstallFence(Date.now(), paths)
    if (current.kind !== 'invalid') {
      return false
    }
    rmSync(paths.fencePath, { force: true })
    return true
  })
}

export function canonicalizeMacUpdatePath(value: string): string {
  if (!isAbsolute(value)) {
    throw new Error('Expected an absolute macOS path')
  }
  const absolutePath = resolve(value)
  try {
    return realpathSync.native(absolutePath)
  } catch {
    const missing: string[] = []
    let cursor = absolutePath
    while (cursor !== dirname(cursor) && !existsSync(cursor)) {
      missing.unshift(basename(cursor))
      cursor = dirname(cursor)
    }
    const canonicalParent = realpathSync.native(cursor)
    return join(canonicalParent, ...missing)
  }
}

function ensureFenceDirectory(directoryPath: string): void {
  mkdirSync(directoryPath, { recursive: true, mode: 0o700 })
  const stats = lstatSync(directoryPath)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('macOS update fence directory is not a regular directory')
  }
}

export function withMacUpdateFenceLock<T>(paths: MacUpdateFencePaths, operation: () => T): T {
  ensureFenceDirectory(paths.directoryPath)
  const deadline = Date.now() + LOCK_WAIT_MS
  while (true) {
    try {
      mkdirSync(paths.lockPath, { mode: 0o700 })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      removeStaleLock(paths.lockPath)
      if (Date.now() >= deadline) {
        throw new Error('Timed out acquiring macOS update fence lock')
      }
      sleepSync(10)
    }
  }
  try {
    cleanupTemporaryFiles(paths)
    return operation()
  } finally {
    rmSync(paths.lockPath, { recursive: true, force: true })
  }
}

function removeStaleLock(lockPath: string): void {
  try {
    const stats = statSync(lockPath)
    if (stats.isDirectory() && Date.now() - stats.mtimeMs > STALE_LOCK_MS) {
      rmSync(lockPath, { recursive: true, force: true })
    }
  } catch {
    // A concurrent owner may have released the lock between the checks.
  }
}

function writeFenceAtomically(targetPath: string, fence: MacUpdateInstallFence): void {
  writeAtomically(targetPath, serializeFence(fence))
}

function writeAtomically(targetPath: string, contents: string): void {
  // Why: fence replacement needs the same temp-file, mode, and rename
  // guarantees as other user-only state; keep that policy in one primitive.
  writeSecureFile(targetPath, contents)
}

function serializeFence(fence: MacUpdateInstallFence): string {
  return `${JSON.stringify(fence)}\n`
}

function cleanupTemporaryFiles(paths: MacUpdateFencePaths): void {
  const prefix = `${FENCE_FILENAME}.`
  for (const name of readdirSync(paths.directoryPath).slice(0, 256)) {
    if (name.startsWith(prefix) && name.endsWith('.tmp')) {
      rmSync(join(paths.directoryPath, name), { force: true })
    }
  }
}

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4))
function sleepSync(milliseconds: number): void {
  Atomics.wait(sleepBuffer, 0, 0, milliseconds)
}
