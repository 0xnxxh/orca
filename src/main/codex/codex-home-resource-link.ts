import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'

// Why: shared, byte-preserving primitives for linking (or, on stock Windows,
// warned-copying) the user's real ~/.codex resources into an Orca-owned Codex
// home, tracking copy ownership so later syncs can refresh or remove only what
// Orca created. Kept separate so both the shared-mirror lane (codex-home-paths)
// and the per-account overlay lane (codex-overlay-home-paths) reuse one copy of
// the ownership/marker logic instead of duplicating it.

export const CODEX_GLOBAL_INSTRUCTIONS_ENTRY = 'AGENTS.md'

export function linkSystemCodexResource(
  systemHomePath: string,
  managedHomePath: string,
  entryName: string,
  { preferCopy = false }: { preferCopy?: boolean } = {}
): void {
  const sourcePath = join(systemHomePath, entryName)
  const targetPath = join(managedHomePath, entryName)
  if (!existsSync(sourcePath)) {
    removeCopiedResourceIfOwned(targetPath, managedHomePath, entryName, sourcePath)
    return
  }
  if (entryName === CODEX_GLOBAL_INSTRUCTIONS_ENTRY && !systemResourceIsRegularFile(sourcePath)) {
    removeCopiedResourceIfOwned(targetPath, managedHomePath, entryName, sourcePath)
    console.warn('[codex-home] Ignoring non-file system Codex resource:', entryName)
    return
  }

  if (targetAlreadyPointsToSource(targetPath, sourcePath)) {
    clearCopiedResourceMarker(managedHomePath, entryName)
    if (!preferCopy || !removeSymlinkEntry(targetPath)) {
      return
    }
  }
  const shouldRefreshFallbackCopy = targetIsOwnedFallbackCopy(
    targetPath,
    managedHomePath,
    entryName,
    sourcePath
  )
  if (pathEntryExists(targetPath) && !shouldRefreshFallbackCopy) {
    return
  }
  if (shouldRefreshFallbackCopy) {
    // Why: WSL launch preparation runs before every Codex start. Avoid
    // rewriting an unchanged file across the UNC boundary on every launch.
    if (
      entryName === CODEX_GLOBAL_INSTRUCTIONS_ENTRY &&
      copiedFileContentsMatch(sourcePath, targetPath)
    ) {
      return
    }
    rmSync(targetPath, { recursive: true, force: true })
  }

  if (preferCopy) {
    copySystemCodexResourceAsOwnedFallback(sourcePath, targetPath, managedHomePath, entryName)
    return
  }

  try {
    const sourceStat = lstatSync(sourcePath)
    symlinkSync(
      sourcePath,
      targetPath,
      sourceStat.isDirectory() && process.platform === 'win32' ? 'junction' : undefined
    )
    clearCopiedResourceMarker(managedHomePath, entryName)
  } catch (error) {
    // Why: Windows can reject file symlinks outside developer mode. Copy is
    // a fallback for launch-time resources; mark ownership so later syncs can
    // refresh the copy without touching user-created runtime resources.
    copySystemCodexResourceAsOwnedFallback(
      sourcePath,
      targetPath,
      managedHomePath,
      entryName,
      error
    )
  }
}

export function copySystemCodexResourceAsOwnedFallback(
  sourcePath: string,
  targetPath: string,
  managedHomePath: string,
  entryName: string,
  symlinkError?: unknown
): void {
  try {
    rmSync(targetPath, { recursive: true, force: true })
    cpSync(sourcePath, targetPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      // Why: dotfile managers commonly symlink AGENTS.md. WSL needs the file
      // contents because a copied host-side link is not usable in the distro.
      dereference: entryName === CODEX_GLOBAL_INSTRUCTIONS_ENTRY
    })
    markCopiedResource(managedHomePath, entryName, sourcePath)
  } catch (copyError) {
    // Why: an unmarked copy cannot be refreshed or safely removed later.
    // Roll it back instead of stranding stale instructions in the runtime home.
    try {
      rmSync(targetPath, { recursive: true, force: true })
    } catch (cleanupError) {
      console.warn(
        '[codex-home] Failed to remove incomplete resource copy:',
        entryName,
        cleanupError
      )
    }
    console.warn(
      '[codex-home] Failed to mirror system Codex resource:',
      entryName,
      symlinkError ?? copyError
    )
  }
}

export function systemResourceIsRegularFile(sourcePath: string): boolean {
  try {
    return statSync(sourcePath).isFile()
  } catch {
    return false
  }
}

export function pathEntryExists(entryPath: string): boolean {
  try {
    lstatSync(entryPath)
    return true
  } catch {
    return false
  }
}

export function copiedFileContentsMatch(sourcePath: string, targetPath: string): boolean {
  try {
    // Why: reading a FIFO or device synchronously can block Codex launch.
    // Follow source symlinks, but only compare two regular files.
    if (!statSync(sourcePath).isFile() || !lstatSync(targetPath).isFile()) {
      return false
    }
    return readFileSync(sourcePath).equals(readFileSync(targetPath))
  } catch {
    return false
  }
}

export function targetAlreadyPointsToSource(targetPath: string, sourcePath: string): boolean {
  try {
    return (
      lstatSync(targetPath).isSymbolicLink() &&
      linkTargetsMatch(readlinkSync(targetPath), sourcePath)
    )
  } catch {
    return false
  }
}

function linkTargetsMatch(actualTarget: string, expectedTarget: string): boolean {
  if (process.platform !== 'win32') {
    return actualTarget === expectedTarget
  }
  return normalizeWindowsLinkTarget(actualTarget) === normalizeWindowsLinkTarget(expectedTarget)
}

function normalizeWindowsLinkTarget(linkTarget: string): string {
  return linkTarget.replace(/^\\\\\?\\/, '').toLowerCase()
}

function getResourceCopyMarkerPath(managedHomePath: string, entryName: string): string {
  return join(managedHomePath, '.orca-resource-copies', `${entryName}.json`)
}

function markCopiedResource(managedHomePath: string, entryName: string, sourcePath: string): void {
  const markerPath = getResourceCopyMarkerPath(managedHomePath, entryName)
  mkdirSync(dirname(markerPath), { recursive: true })
  writeFileSync(markerPath, `${JSON.stringify({ sourcePath }, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600
  })
}

function readCopiedResourceSourcePath(managedHomePath: string, entryName: string): string | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(getResourceCopyMarkerPath(managedHomePath, entryName), 'utf-8')
    )
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const sourcePath = 'sourcePath' in parsed ? parsed.sourcePath : null
    return typeof sourcePath === 'string' ? sourcePath : null
  } catch {
    return null
  }
}

export function clearCopiedResourceMarker(managedHomePath: string, entryName: string): void {
  // Why: a malformed marker directory must not block Codex launch or prevent
  // an owned resource from being repaired.
  rmSync(getResourceCopyMarkerPath(managedHomePath, entryName), {
    recursive: true,
    force: true
  })
}

export function targetIsOwnedFallbackCopy(
  targetPath: string,
  managedHomePath: string,
  entryName: string,
  sourcePath: string
): boolean {
  if (readCopiedResourceSourcePath(managedHomePath, entryName) !== sourcePath) {
    return false
  }
  try {
    return existsSync(targetPath) && !lstatSync(targetPath).isSymbolicLink()
  } catch {
    return false
  }
}

export function removeCopiedResourceIfOwned(
  targetPath: string,
  managedHomePath: string,
  entryName: string,
  sourcePath: string
): void {
  if (removeSymlinkedResourceIfOwned(targetPath, sourcePath)) {
    clearCopiedResourceMarker(managedHomePath, entryName)
    return
  }
  if (!targetIsOwnedFallbackCopy(targetPath, managedHomePath, entryName, sourcePath)) {
    return
  }
  rmSync(targetPath, { recursive: true, force: true })
  clearCopiedResourceMarker(managedHomePath, entryName)
}

function removeSymlinkedResourceIfOwned(targetPath: string, sourcePath: string): boolean {
  try {
    if (!lstatSync(targetPath).isSymbolicLink()) {
      return false
    }
    if (!linkTargetsMatch(readlinkSync(targetPath), sourcePath)) {
      return false
    }
    return removeSymlinkEntry(targetPath)
  } catch {
    return false
  }
}

function removeSymlinkEntry(targetPath: string): boolean {
  try {
    // Why: recursive rm can leave a broken directory symlink behind; unlink the
    // link entry itself so deleted system resources do not linger in runtime home.
    unlinkSync(targetPath)
    return true
  } catch {
    if (process.platform !== 'win32') {
      return false
    }
  }

  try {
    rmdirSync(targetPath)
    return true
  } catch {
    return false
  }
}
