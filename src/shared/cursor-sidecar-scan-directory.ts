import type { Dirent } from 'node:fs'
import { opendir, readdir } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

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

export async function streamDirectoryNames(
  dirPath: string,
  visit: (name: string, entry: Dirent) => void
): Promise<void> {
  try {
    const directory = await opendir(dirPath)
    for await (const entry of directory) {
      visit(entry.name, entry)
    }
    return
  } catch (error) {
    // Fallback keeps remote-wire hosts that only expose readdir working.
    if (!isUnsupportedDirectoryStream(error)) {
      throw error
    }
  }
  const entries = await readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    visit(entry.name, entry)
  }
}

export async function listLexicographicDirectoryNames(args: {
  dirPath: string
  limit: number
  accept: (name: string, entry: Dirent) => boolean
}): Promise<{ names: string[]; truncated: boolean }> {
  if (args.limit <= 0) {
    return { names: [], truncated: true }
  }
  const selected: string[] = []
  let truncated = false
  await streamDirectoryNames(args.dirPath, (name, entry) => {
    if (!args.accept(name, entry)) {
      return
    }
    if (retainLexicographic(selected, name, args.limit)) {
      truncated = true
    }
  })
  if (selected.length < args.limit) {
    selected.sort((left, right) => left.localeCompare(right))
  }
  return { names: selected, truncated }
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
