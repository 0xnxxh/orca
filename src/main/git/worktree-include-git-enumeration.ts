import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'
import type { WorktreeIncludePattern } from './worktree-include-pattern'

// Why: Windows limits native command lines to 32K UTF-16 code units; leave room for Git's fixed arguments and repo path.
const WORKTREE_INCLUDE_PATHSPEC_CHUNK_LENGTH = 12 * 1024

export type GitignoredEntry = {
  relativePath: string
  isDirectory: boolean
  coversDescendants: boolean
}

type ListGitignoredEntriesOptions = {
  collapseDirectories: boolean
  pathspecs?: readonly string[]
  timeout: number
}

type GitExecError = Error & { code?: number | string }

function* parseGitignoredEntries(
  stdout: string,
  collapseDirectories: boolean
): IterableIterator<GitignoredEntry> {
  let start = 0
  while (start < stdout.length) {
    const separator = stdout.indexOf('\0', start)
    const end = separator === -1 ? stdout.length : separator
    const rawEntry = stdout.slice(start, end)
    start = end + 1
    if (!rawEntry) {
      continue
    }
    const isDirectory = rawEntry.endsWith('/')
    yield {
      relativePath: isDirectory ? rawEntry.replace(/\/+$/, '') : rawEntry,
      isDirectory,
      coversDescendants: isDirectory && collapseDirectories
    }
  }
}

export async function getWorktreeIncludeIgnoreCase(
  repoPath: string,
  options: GitRuntimeOptions,
  timeout: number
): Promise<boolean> {
  try {
    const { stdout } = await gitExecFileAsync(['config', '--bool', 'core.ignoreCase'], {
      ...gitOptionsForWorktree(repoPath, options),
      timeout
    })
    return stdout.trim() === 'true'
  } catch (error) {
    const code = (error as GitExecError).code
    if (code === 1 || code === '1') {
      return false
    }
    throw error
  }
}

export async function listGitignoredEntries(
  repoPath: string,
  options: GitRuntimeOptions,
  listOptions: ListGitignoredEntriesOptions
): Promise<IterableIterator<GitignoredEntry>> {
  const args = [
    '-c',
    'core.quotePath=false',
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    ...(listOptions.collapseDirectories ? ['--directory'] : []),
    '-z',
    ...(listOptions.pathspecs ? ['--', ...listOptions.pathspecs] : [])
  ]
  const { stdout } = await gitExecFileAsync(args, {
    ...gitOptionsForWorktree(repoPath, options),
    timeout: listOptions.timeout
  })
  // Why: lazy parsing lets caller budgets stop before large Git output becomes a large object array.
  return parseGitignoredEntries(stdout, listOptions.collapseDirectories)
}

export function worktreeIncludePatternToGitPathspec(
  pattern: WorktreeIncludePattern,
  ignoreCase: boolean = false
): string {
  // Why: our matcher treats `[` literally, while Git pathspec globs treat it as a character class opener.
  const body = pattern.body.replaceAll('[', '[[]')
  return `:(${ignoreCase ? 'icase,' : ''}glob)${pattern.anchored ? '' : '**/'}${body}`
}

export function worktreeIncludePatternToGitDescendantPathspec(
  pattern: WorktreeIncludePattern,
  ignoreCase: boolean = false
): string {
  return `${worktreeIncludePatternToGitPathspec(pattern, ignoreCase)}/**`
}

export function chunkWorktreeIncludePathspecs(
  pathspecs: readonly string[],
  sharedPathspecs: readonly string[] = []
): string[][] {
  const chunks: string[][] = []
  let chunk: string[] = []
  const shared = Array.from(new Set(sharedPathspecs))
  const sharedLength = shared.reduce((length, pathspec) => length + pathspec.length, 0)
  const uniquePathspecs = Array.from(new Set(pathspecs))
  // Why: dropping exclusions can cost a bounded rescan, but dropping the scan silently misses nested config files.
  const effectiveShared =
    sharedLength < WORKTREE_INCLUDE_PATHSPEC_CHUNK_LENGTH &&
    uniquePathspecs.every(
      (pathspec) => pathspec.length + sharedLength <= WORKTREE_INCLUDE_PATHSPEC_CHUNK_LENGTH
    )
      ? shared
      : []
  const effectiveSharedLength = effectiveShared.reduce(
    (length, pathspec) => length + pathspec.length,
    0
  )
  let chunkLength = effectiveSharedLength
  for (const pathspec of uniquePathspecs) {
    // Why: the collapsed scan remains a safe fallback when one pattern cannot fit the Windows command line.
    if (pathspec.length + effectiveSharedLength > WORKTREE_INCLUDE_PATHSPEC_CHUNK_LENGTH) {
      continue
    }
    if (
      chunk.length > 0 &&
      chunkLength + pathspec.length > WORKTREE_INCLUDE_PATHSPEC_CHUNK_LENGTH
    ) {
      chunks.push([...chunk, ...effectiveShared])
      chunk = []
      chunkLength = effectiveSharedLength
    }
    chunk.push(pathspec)
    chunkLength += pathspec.length
  }
  if (chunk.length > 0) {
    chunks.push([...chunk, ...effectiveShared])
  }
  return chunks
}
