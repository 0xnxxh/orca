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

export async function listGitignoredEntries(
  repoPath: string,
  options: GitRuntimeOptions,
  listOptions: ListGitignoredEntriesOptions
): Promise<GitignoredEntry[]> {
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
  const entries: GitignoredEntry[] = []
  for (const rawEntry of stdout.split('\0')) {
    if (!rawEntry) {
      continue
    }
    const isDirectory = rawEntry.endsWith('/')
    entries.push({
      relativePath: isDirectory ? rawEntry.replace(/\/+$/, '') : rawEntry,
      isDirectory,
      coversDescendants: isDirectory && listOptions.collapseDirectories
    })
  }
  return entries
}

export function worktreeIncludePatternToGitPathspec(pattern: WorktreeIncludePattern): string {
  // Why: our matcher treats `[` literally, while Git pathspec globs treat it as a character class opener.
  const body = pattern.body.replaceAll('[', '[[]')
  return `:(glob)${pattern.anchored ? '' : '**/'}${body}`
}

export function worktreeIncludePatternToGitDescendantPathspec(
  pattern: WorktreeIncludePattern
): string {
  return `${worktreeIncludePatternToGitPathspec(pattern)}/**`
}

export function chunkWorktreeIncludePathspecs(
  pathspecs: readonly string[],
  sharedPathspecs: readonly string[] = []
): string[][] {
  const chunks: string[][] = []
  let chunk: string[] = []
  const shared = Array.from(new Set(sharedPathspecs))
  const sharedLength = shared.reduce((length, pathspec) => length + pathspec.length, 0)
  if (sharedLength >= WORKTREE_INCLUDE_PATHSPEC_CHUNK_LENGTH) {
    return chunks
  }
  let chunkLength = sharedLength
  for (const pathspec of new Set(pathspecs)) {
    // Why: the collapsed scan remains a safe fallback when one pattern cannot fit the Windows command line.
    if (pathspec.length + sharedLength > WORKTREE_INCLUDE_PATHSPEC_CHUNK_LENGTH) {
      continue
    }
    if (
      chunk.length > 0 &&
      chunkLength + pathspec.length > WORKTREE_INCLUDE_PATHSPEC_CHUNK_LENGTH
    ) {
      chunks.push([...chunk, ...shared])
      chunk = []
      chunkLength = sharedLength
    }
    chunk.push(pathspec)
    chunkLength += pathspec.length
  }
  if (chunk.length > 0) {
    chunks.push([...chunk, ...shared])
  }
  return chunks
}
