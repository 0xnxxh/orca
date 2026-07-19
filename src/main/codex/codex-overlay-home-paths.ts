import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { getSystemCodexHomePath } from './codex-home-paths'
import {
  CODEX_GLOBAL_INSTRUCTIONS_ENTRY,
  clearCopiedResourceMarker,
  copiedFileContentsMatch,
  copySystemCodexResourceAsOwnedFallback,
  removeCopiedResourceIfOwned,
  systemResourceIsRegularFile,
  targetAlreadyPointsToSource,
  targetIsOwnedFallbackCopy
} from './codex-home-resource-link'

// Why: per-account overlay homes (flag-ON self-contained CODEX_HOME) symlink
// config.toml + hooks.json + the resource dirs to the user's real ~/.codex so
// codex's canonicalizing atomic writes land there and no copied config can drift.
// sessions/ and the sqlite history index stay REAL per account, so they are
// intentionally absent here.
const CODEX_OVERLAY_SYMLINK_ENTRIES = [
  'config.toml',
  'hooks.json',
  'skills',
  'hooks',
  'plugins',
  'plugin-state',
  'profile-v2',
  'themes',
  'prompts',
  CODEX_GLOBAL_INSTRUCTIONS_ENTRY
] as const

const CODEX_OVERLAY_STALE_MARKER = '.orca-overlay-stale.json'

// Why: builds a thin symlink OVERLAY home for a per-account managed CODEX_HOME.
// config.toml + hooks.json + the resource dirs point at the user's real ~/.codex
// (dirs become junctions on Windows), so codex reads shared settings and writes
// hook/project trust straight through to ~/.codex with zero divergence. Real,
// per-account files (auth.json, models_cache.json, .credentials.json, sessions/,
// the sqlite index) are never symlinked and are left untouched here. Returns the
// entries that could not be symlinked (stock Windows without Developer Mode) so
// the caller can surface an explicit "settings may be out of date" account-row
// warning; those entries fall back to a single WARNED copy with no write-back.
export function syncSystemCodexOverlayResourcesIntoManagedHome(
  overlayHomePath: string,
  systemHomePath: string = getSystemCodexHomePath()
): { staleEntries: string[] } {
  mkdirSync(overlayHomePath, { recursive: true })
  const staleEntries: string[] = []
  for (const entryName of CODEX_OVERLAY_SYMLINK_ENTRIES) {
    linkOverlayCodexResource(systemHomePath, overlayHomePath, entryName, staleEntries)
  }
  persistOverlayStaleMarker(overlayHomePath, staleEntries)
  return { staleEntries }
}

// Why: the account row reads this to warn when a stock-Windows overlay had to
// copy config.toml/AGENTS.md instead of symlinking, so the user knows settings
// changed in ~/.codex may not sync live until Developer Mode is enabled.
export function readCodexOverlayStaleEntries(overlayHomePath: string): string[] {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(overlayHomePath, CODEX_OVERLAY_STALE_MARKER), 'utf-8')
    )
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return []
    }
    const entries = (parsed as { entries?: unknown }).entries
    if (!Array.isArray(entries)) {
      return []
    }
    return entries.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

function persistOverlayStaleMarker(overlayHomePath: string, staleEntries: string[]): void {
  const markerPath = join(overlayHomePath, CODEX_OVERLAY_STALE_MARKER)
  if (staleEntries.length === 0) {
    // Why: a previously stale entry that now symlinks must clear the warning.
    rmSync(markerPath, { force: true })
    return
  }
  try {
    writeFileSync(
      markerPath,
      `${JSON.stringify({ version: 1, entries: staleEntries, updatedAt: Date.now() }, null, 2)}\n`,
      { encoding: 'utf-8', mode: 0o600 }
    )
  } catch (error) {
    console.warn('[codex-home] Failed to record overlay staleness marker:', error)
  }
}

function linkOverlayCodexResource(
  systemHomePath: string,
  overlayHomePath: string,
  entryName: string,
  staleEntries: string[]
): void {
  const sourcePath = join(systemHomePath, entryName)
  const targetPath = join(overlayHomePath, entryName)
  if (!existsSync(sourcePath)) {
    // Why: a deleted/absent source must drop an owned overlay symlink or warned
    // copy, but never touch a config.toml the user only has under real ~/.codex.
    removeCopiedResourceIfOwned(targetPath, overlayHomePath, entryName, sourcePath)
    return
  }
  if (entryName === CODEX_GLOBAL_INSTRUCTIONS_ENTRY && !systemResourceIsRegularFile(sourcePath)) {
    removeCopiedResourceIfOwned(targetPath, overlayHomePath, entryName, sourcePath)
    console.warn('[codex-home] Ignoring non-file system Codex resource:', entryName)
    return
  }
  if (targetAlreadyPointsToSource(targetPath, sourcePath)) {
    clearCopiedResourceMarker(overlayHomePath, entryName)
    return
  }

  // Why: try the symlink at a temp name and swap it in atomically, so a
  // pre-existing warned copy (or a legacy copied config.toml being migrated, or
  // a self-heal of a config.toml that regressed to a regular file) is only
  // removed once the link is proven creatable. Never leaves the slot empty.
  const nextLinkPath = `${targetPath}.orca-next-${process.pid}-${Date.now()}`
  rmSync(nextLinkPath, { recursive: true, force: true })
  try {
    const sourceIsDir = lstatSync(sourcePath).isDirectory()
    symlinkSync(
      sourcePath,
      nextLinkPath,
      sourceIsDir && process.platform === 'win32' ? 'junction' : undefined
    )
  } catch (symlinkError) {
    rmSync(nextLinkPath, { recursive: true, force: true })
    // Why: stock Windows rejects symlinks/junctions without Developer Mode. Do
    // NOT silently copy — record the entry as STALE (surfaced on the account
    // row) and keep a single warned copy so codex still launches. No write-back.
    warnOnceCopyOverlayResource(
      sourcePath,
      targetPath,
      overlayHomePath,
      entryName,
      staleEntries,
      symlinkError
    )
    return
  }
  try {
    rmSync(targetPath, { recursive: true, force: true })
    renameSync(nextLinkPath, targetPath)
    clearCopiedResourceMarker(overlayHomePath, entryName)
  } catch (error) {
    rmSync(nextLinkPath, { recursive: true, force: true })
    console.warn('[codex-home] Failed to install overlay Codex resource symlink:', entryName, error)
  }
}

function warnOnceCopyOverlayResource(
  sourcePath: string,
  targetPath: string,
  overlayHomePath: string,
  entryName: string,
  staleEntries: string[],
  symlinkError: unknown
): void {
  if (!staleEntries.includes(entryName)) {
    staleEntries.push(entryName)
  }
  if (targetIsOwnedFallbackCopy(targetPath, overlayHomePath, entryName, sourcePath)) {
    // Why: codex writes this overlay's hook/project trust INTO the warned
    // config.toml copy, so a divergence-triggered refresh would wipe that trust
    // and force an app-server re-grant plus project re-approval on every
    // launch. Keep the copy truly one-time; the stale marker covers the drift.
    if (entryName === 'config.toml') {
      return
    }
    // Why: refreshing an unchanged owned copy every launch is wasteful churn on
    // a host where symlinks keep failing; skip when the file copy already matches.
    if (
      systemResourceIsRegularFile(sourcePath) &&
      copiedFileContentsMatch(sourcePath, targetPath)
    ) {
      return
    }
  }
  console.warn(
    `[codex-home] Symlink unavailable for overlay Codex resource "${entryName}"; kept a one-time copy. ` +
      'Settings for this account may be out of date — enable Windows Developer Mode for live sync.',
    symlinkError
  )
  copySystemCodexResourceAsOwnedFallback(
    sourcePath,
    targetPath,
    overlayHomePath,
    entryName,
    symlinkError
  )
}
