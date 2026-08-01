import type { Stats } from 'node:fs'

export type HardenedPathCacheEntry = {
  isDirectory: boolean
  dev: number
  ino: number
  size: number
  mode: number
  ctimeMs: number
  mtimeMs: number
  birthtimeMs: number
}

/**
 * Snapshots a path's identity, mode, and timestamps so later drift is detectable.
 * Mode is tracked directly so a chmod is caught even where coarse ctime granularity hides it.
 */
export function toHardenedPathCacheEntry(
  stats: Stats,
  isDirectory: boolean
): HardenedPathCacheEntry | null {
  if (stats.isDirectory() !== isDirectory) {
    return null
  }
  return {
    isDirectory,
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mode: stats.mode & 0o777,
    ctimeMs: stats.ctimeMs,
    mtimeMs: stats.mtimeMs,
    birthtimeMs: stats.birthtimeMs
  }
}

/** True when two snapshots describe the same unchanged path (identity, mode, timestamps). */
export function hardenedPathCacheEntriesMatch(
  a: HardenedPathCacheEntry,
  b: HardenedPathCacheEntry
): boolean {
  return (
    a.isDirectory === b.isDirectory &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mode === b.mode &&
    a.ctimeMs === b.ctimeMs &&
    a.mtimeMs === b.mtimeMs &&
    a.birthtimeMs === b.birthtimeMs
  )
}
