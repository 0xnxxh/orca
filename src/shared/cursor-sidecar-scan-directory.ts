import type { Dir, Dirent } from 'node:fs'
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
  /** Invoked once per examined dirent (not the overflow probe). */
  onDirent?: () => void
  /** Hard stop after this many dirents; default CURSOR_DIR_MAX_ENTRIES_EXAMINED. */
  maxEntriesExamined?: number
}

type StreamDirectoryIo = {
  opendir: (path: string) => ReturnType<typeof opendir>
  readdirWithFileTypes: (path: string) => Promise<Dirent[]>
}

const defaultStreamDirectoryIo: StreamDirectoryIo = {
  opendir,
  readdirWithFileTypes: (path) => readdir(path, { withFileTypes: true })
}
let streamDirectoryIo: StreamDirectoryIo = defaultStreamDirectoryIo

/** Test isolation for opendir vs readdir-fallback paths. */
export function setStreamDirectoryIoForTests(next?: Partial<StreamDirectoryIo>): void {
  streamDirectoryIo = next
    ? {
        opendir: next.opendir ?? defaultStreamDirectoryIo.opendir,
        readdirWithFileTypes:
          next.readdirWithFileTypes ?? defaultStreamDirectoryIo.readdirWithFileTypes
      }
    : defaultStreamDirectoryIo
}

/**
 * Streams directory names without materializing the full listing on opendir hosts.
 * Retention callers keep only their bounded selection; examination stops at
 * maxEntriesExamined. One extra dirent is read as an overflow probe so stopping
 * exactly at the budget still reports examinationTruncated truthfully when more
 * entries exist.
 */
export async function streamDirectoryNames(
  dirPath: string,
  visit: (name: string, entry: Dirent) => void,
  options: StreamDirectoryNamesOptions = {}
): Promise<{ entriesExamined: number; examinationTruncated: boolean }> {
  const maxEntries = options.maxEntriesExamined ?? CURSOR_DIR_MAX_ENTRIES_EXAMINED
  if (maxEntries <= 0) {
    return { entriesExamined: 0, examinationTruncated: true }
  }

  try {
    const directory = await streamDirectoryIo.opendir(dirPath)
    try {
      return await examineDirectoryStream(directory, visit, options, maxEntries)
    } finally {
      // Closing mid-iteration is best-effort; for-await also closes on break/throw.
      await directory.close().catch(() => undefined)
    }
  } catch (error) {
    // Fallback keeps remote-wire hosts that only expose readdir working.
    if (!isUnsupportedDirectoryStream(error)) {
      throw error
    }
  }
  return examineReaddirFallback(dirPath, visit, options, maxEntries)
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

async function examineDirectoryStream(
  directory: Dir,
  visit: (name: string, entry: Dirent) => void,
  options: StreamDirectoryNamesOptions,
  maxEntries: number
): Promise<{ entriesExamined: number; examinationTruncated: boolean }> {
  let entriesExamined = 0
  let examinationTruncated = false
  for await (const entry of directory) {
    // Bounded overflow probe: reading one dirent past the budget proves that
    // stopping exactly at maxEntries is truncation, without visiting it.
    if (entriesExamined >= maxEntries) {
      examinationTruncated = true
      break
    }
    entriesExamined += 1
    options.onDirent?.()
    visit(entry.name, entry)
  }
  return { entriesExamined, examinationTruncated }
}

async function examineReaddirFallback(
  dirPath: string,
  visit: (name: string, entry: Dirent) => void,
  options: StreamDirectoryNamesOptions,
  maxEntries: number
): Promise<{ entriesExamined: number; examinationTruncated: boolean }> {
  // Why: readdir eagerly allocates the full listing. Shrink immediately to the
  // examination window so adversarial directories cannot keep an unbounded
  // Dirent array alive past the budget (peak alloc is platform-limited).
  const entries = await streamDirectoryIo.readdirWithFileTypes(dirPath)
  let entriesExamined = 0
  try {
    const examinationTruncated = entries.length > maxEntries
    if (examinationTruncated) {
      entries.length = maxEntries
    }
    for (const entry of entries) {
      entriesExamined += 1
      options.onDirent?.()
      visit(entry.name, entry)
    }
    return { entriesExamined, examinationTruncated }
  } finally {
    entries.length = 0
  }
}

function isUnsupportedDirectoryStream(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' || code === 'ENOTSUP'
}
