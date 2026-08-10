import type { Dirent } from 'node:fs'
import { opendir, readdir } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

/** Per-directory dirent examination budget; keeps cold scans hard-bounded. */
export const CURSOR_DIR_MAX_ENTRIES_EXAMINED = 8_192

/** Returns true when `name` caused the retained set to overflow the limit. */
export function retainLexicographic(selected: string[], name: string, limit: number): boolean {
  if (selected.length < limit) {
    selected.push(name)
    if (selected.length === limit) {
      selected.sort((left, right) => left.localeCompare(right))
    }
    return false
  }
  const last = selected[limit - 1]
  if (name.localeCompare(last) >= 0) {
    return true
  }
  let index = limit - 1
  while (index > 0 && name.localeCompare(selected[index - 1]) < 0) {
    selected[index] = selected[index - 1]
    index -= 1
  }
  selected[index] = name
  return true
}

export type StreamDirectoryNamesOptions = {
  /** Invoked once per dirent observed (opendir read or readdir fallback entry). */
  onDirent?: () => void
  /** Hard stop after this many dirents; default CURSOR_DIR_MAX_ENTRIES_EXAMINED. */
  maxEntriesExamined?: number
}

/**
 * Streams directory names without materializing the full listing.
 * Retention callers keep only their bounded selection; examination stops at
 * maxEntriesExamined so cold adversarial directories cannot unbounded-walk.
 */
export async function streamDirectoryNames(
  dirPath: string,
  visit: (name: string, entry: Dirent) => void,
  options: StreamDirectoryNamesOptions = {}
): Promise<{ entriesExamined: number; examinationTruncated: boolean }> {
  const maxEntries = options.maxEntriesExamined ?? CURSOR_DIR_MAX_ENTRIES_EXAMINED
  let entriesExamined = 0
  let examinationTruncated = false

  const consider = (name: string, entry: Dirent): boolean => {
    if (entriesExamined >= maxEntries) {
      examinationTruncated = true
      return false
    }
    entriesExamined += 1
    options.onDirent?.()
    visit(name, entry)
    return entriesExamined < maxEntries
  }

  try {
    const directory = await opendir(dirPath)
    try {
      for await (const entry of directory) {
        if (!consider(entry.name, entry)) {
          break
        }
      }
    } finally {
      // Closing mid-iteration is best-effort; for-await also closes on break/throw.
      await directory.close().catch(() => undefined)
    }
    return { entriesExamined, examinationTruncated }
  } catch (error) {
    // Fallback keeps remote-wire hosts that only expose readdir working.
    if (!isUnsupportedDirectoryStream(error)) {
      throw error
    }
  }
  const entries = await readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    if (!consider(entry.name, entry)) {
      break
    }
  }
  return { entriesExamined, examinationTruncated }
}

/**
 * Deterministic retention: among accepted names in the first maxEntriesExamined
 * dirents (opendir/readdir order), keep the lexicographic first `limit`.
 * Does not materialize the full directory; only the retained name set is kept.
 */
export async function listLexicographicDirectoryNames(args: {
  dirPath: string
  limit: number
  accept: (name: string, entry: Dirent) => boolean
  maxEntriesExamined?: number
  onDirent?: () => void
}): Promise<{ names: string[]; truncated: boolean; entriesExamined: number }> {
  if (args.limit <= 0) {
    return { names: [], truncated: true, entriesExamined: 0 }
  }
  const selected: string[] = []
  let truncated = false
  const { entriesExamined, examinationTruncated } = await streamDirectoryNames(
    args.dirPath,
    (name, entry) => {
      if (!args.accept(name, entry)) {
        return
      }
      if (retainLexicographic(selected, name, args.limit)) {
        truncated = true
      }
    },
    {
      maxEntriesExamined: args.maxEntriesExamined,
      onDirent: args.onDirent
    }
  )
  if (examinationTruncated) {
    truncated = true
  }
  if (selected.length < args.limit) {
    selected.sort((left, right) => left.localeCompare(right))
  }
  return { names: selected, truncated, entriesExamined }
}

export function targetPathVariants(value: string, pathPlatform: NodeJS.Platform): string[] {
  const pathOps = pathPlatform === 'win32' ? win32 : posix
  if (!pathOps.isAbsolute(value)) {
    return []
  }
  const resolved = pathOps.resolve(value)
  if (pathPlatform !== 'win32') {
    return [resolved]
  }
  const match = /^([A-Za-z]):/u.exec(resolved)
  return match
    ? [
        ...new Set([
          resolved,
          `${match[1].toUpperCase()}${resolved.slice(1)}`,
          `${match[1].toLowerCase()}${resolved.slice(1)}`
        ])
      ]
    : [resolved]
}

export function safeBasename(value: string): boolean {
  return Boolean(value && value !== '.' && value !== '..' && !/[\\/]/u.test(value))
}

function isUnsupportedDirectoryStream(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' || code === 'ENOTSUP'
}
