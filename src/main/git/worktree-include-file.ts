import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { checkIgnoredPaths } from './check-ignored-paths'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'
import {
  compileWorktreeIncludeGlob,
  getWorktreeIncludeGlobStepCount,
  matchesWorktreeIncludeGlob,
  type CompiledWorktreeIncludeGlob
} from './worktree-include-glob'

/** Project-level list of gitignored paths to copy into each new worktree.
 *  Cross-tool convention (gitignore syntax); see issue #7549. */
export const WORKTREE_INCLUDE_FILE = '.worktreeinclude'

// Why: reading the include file must never delay worktree creation on a wedged
// filesystem or a pathological repo; bail and create the worktree without it.
const WORKTREE_INCLUDE_GIT_TIMEOUT_MS = 15_000
const WORKTREE_INCLUDE_MAX_FILE_BYTES = 256 * 1024
// Why: glob filtering runs on the main process outside the Git subprocess deadline.
const WORKTREE_INCLUDE_GLOB_STEP_BUDGET = 5_000_000
// Why: Windows limits native command lines to 32K UTF-16 code units; leave
// room for Git's executable, fixed arguments, and the repository path.
const WORKTREE_INCLUDE_PATHSPEC_CHUNK_LENGTH = 12 * 1024

type WorktreeIncludePattern = {
  negated: boolean
  /** Pattern with `!`, leading `/`, and trailing `/` stripped. */
  body: string
  dirOnly: boolean
  anchored: boolean
  hasGlob: boolean
  glob: CompiledWorktreeIncludeGlob | null
}

export function parseWorktreeIncludePatterns(content: string): WorktreeIncludePattern[] {
  const patterns: WorktreeIncludePattern[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const negated = line.startsWith('!')
    const withoutNegation = negated ? line.slice(1) : line
    const dirOnly = withoutNegation.endsWith('/')
    // Why: gitignore semantics — a slash anywhere except the end anchors the
    // pattern to the repo root; a bare name matches at any depth.
    const trimmed = withoutNegation.replace(/^\//, '').replace(/\/+$/, '')
    if (!trimmed) {
      continue
    }
    const anchored = withoutNegation.startsWith('/') || trimmed.includes('/')
    const hasGlob = /[*?]/.test(trimmed)
    patterns.push({
      negated,
      body: trimmed,
      dirOnly,
      anchored,
      hasGlob,
      glob: hasGlob ? compileWorktreeIncludeGlob(trimmed) : null
    })
  }
  return patterns
}

function patternMatches(
  pattern: WorktreeIncludePattern,
  relativePath: string,
  isDirectory: boolean,
  globBudget: { remaining: number }
): boolean {
  if (pattern.dirOnly && !isDirectory) {
    return false
  }
  // Why: like gitignore, a matched directory brings everything beneath it, so
  // a path inside a matched prefix counts as matched.
  const subject = pattern.anchored ? relativePath : (relativePath.split('/').at(-1) ?? relativePath)
  if (!pattern.hasGlob) {
    return (
      subject === pattern.body || (pattern.anchored && relativePath.startsWith(`${pattern.body}/`))
    )
  }
  if (pattern.glob === null) {
    return false
  }
  globBudget.remaining -= getWorktreeIncludeGlobStepCount(pattern.glob, subject)
  if (globBudget.remaining < 0) {
    throw new Error(`${WORKTREE_INCLUDE_FILE} glob matching exceeded its CPU budget`)
  }
  return matchesWorktreeIncludeGlob(pattern.glob, subject)
}

function isIncludedByPatterns(
  patterns: readonly WorktreeIncludePattern[],
  relativePath: string,
  isDirectory: boolean,
  globBudget: { remaining: number }
): boolean {
  // Why: gitignore semantics — the last matching pattern wins, so `!` lines
  // can carve exceptions out of an earlier broad include.
  let included = false
  for (const pattern of patterns) {
    if (patternMatches(pattern, relativePath, isDirectory, globBudget)) {
      included = !pattern.negated
    }
  }
  return included
}

function isSafeIncludeCandidate(relativePath: string): boolean {
  if (!relativePath || isAbsolute(relativePath)) {
    return false
  }
  const segments = relativePath.split(/[\\/]/)
  return !segments.includes('..') && segments[0] !== '.git'
}

type GitignoredEntry = {
  relativePath: string
  isDirectory: boolean
}

type ListGitignoredEntriesOptions = {
  collapseDirectories: boolean
  pathspecs?: readonly string[]
  timeout: number
}

async function listGitignoredEntries(
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
      isDirectory
    })
  }
  return entries
}

function patternToGitPathspec(pattern: WorktreeIncludePattern): string {
  // Why: our supported matcher treats `[` literally, while Git pathspec globs
  // treat it as a character class opener.
  const body = pattern.body.replaceAll('[', '[[]')
  return `:(glob)${pattern.anchored ? '' : '**/'}${body}`
}

function chunkPathspecs(pathspecs: readonly string[]): string[][] {
  const chunks: string[][] = []
  let chunk: string[] = []
  let chunkLength = 0
  for (const pathspec of new Set(pathspecs)) {
    // A single impossible-to-match pattern must not exceed Windows' process
    // command-line limit; the collapsed scan still provides safe fallback.
    if (pathspec.length > WORKTREE_INCLUDE_PATHSPEC_CHUNK_LENGTH) {
      continue
    }
    if (
      chunk.length > 0 &&
      chunkLength + pathspec.length > WORKTREE_INCLUDE_PATHSPEC_CHUNK_LENGTH
    ) {
      chunks.push(chunk)
      chunk = []
      chunkLength = 0
    }
    chunk.push(pathspec)
    chunkLength += pathspec.length
  }
  if (chunk.length > 0) {
    chunks.push(chunk)
  }
  return chunks
}

async function readWorktreeIncludeFile(repoPath: string): Promise<string | null> {
  const includePath = join(repoPath, WORKTREE_INCLUDE_FILE)
  try {
    const stats = await lstat(includePath)
    if (!stats.isFile() || stats.size > WORKTREE_INCLUDE_MAX_FILE_BYTES) {
      return null
    }
    return await readFile(includePath, 'utf8')
  } catch {
    return null
  }
}

/** Resolve `.worktreeinclude` at the repo root to concrete repo-relative paths
 *  to copy into a new worktree.
 *
 *  Semantics match the cross-tool convention: gitignore syntax, and only paths
 *  that are actually gitignored are ever returned — tracked files are already
 *  present in a fresh worktree, and untracked-but-not-ignored files would show
 *  up as spurious diffs.
 *
 *  Never throws: any read/parse/git failure resolves to `[]` so worktree
 *  creation is never blocked by this file. */
export async function resolveWorktreeIncludePaths(
  repoPath: string,
  options: GitRuntimeOptions = {}
): Promise<string[]> {
  try {
    const content = await readWorktreeIncludeFile(repoPath)
    if (content === null) {
      return []
    }
    const patterns = parseWorktreeIncludePatterns(content)
    if (!patterns.some((pattern) => !pattern.negated)) {
      return []
    }

    const candidates = new Map<string, GitignoredEntry>()
    const globBudget = { remaining: WORKTREE_INCLUDE_GLOB_STEP_BUDGET }
    const addCandidate = (entry: GitignoredEntry): void => {
      if (
        isSafeIncludeCandidate(entry.relativePath) &&
        isIncludedByPatterns(patterns, entry.relativePath, entry.isDirectory, globBudget)
      ) {
        candidates.set(entry.relativePath, entry)
      }
    }

    // Literal patterns resolve by direct stat so they work even for paths
    // nested inside a wholly-gitignored directory that ls-files collapses.
    for (const pattern of patterns) {
      if (pattern.negated || pattern.hasGlob || !isSafeIncludeCandidate(pattern.body)) {
        continue
      }
      try {
        const stats = await lstat(join(repoPath, pattern.body))
        addCandidate({ relativePath: pattern.body, isDirectory: stats.isDirectory() })
      } catch {
        // Absent in the primary checkout — nothing to copy.
      }
    }

    const broadPatterns = patterns.filter(
      (pattern) => !pattern.negated && (pattern.hasGlob || !pattern.anchored)
    )
    if (broadPatterns.length > 0) {
      const deadline = Date.now() + WORKTREE_INCLUDE_GIT_TIMEOUT_MS
      // Why: collapsing ignored directories prevents huge trees such as
      // node_modules from producing one entry per file.
      for (const entry of await listGitignoredEntries(repoPath, options, {
        collapseDirectories: true,
        timeout: Math.max(1, deadline - Date.now())
      })) {
        addCandidate(entry)
      }

      // Why: Git 2.25's directory collapsing can stop at an untracked parent
      // before discovering nested ignored files; targeted scans preserve the
      // cross-version behavior without expanding unrelated ignored trees.
      const filePathspecs = broadPatterns
        .filter((pattern) => !pattern.dirOnly)
        .map(patternToGitPathspec)
      for (const pathspecs of chunkPathspecs(filePathspecs)) {
        const timeout = deadline - Date.now()
        if (timeout <= 0) {
          throw new Error(`${WORKTREE_INCLUDE_FILE} Git enumeration timed out`)
        }
        for (const entry of await listGitignoredEntries(repoPath, options, {
          collapseDirectories: false,
          pathspecs,
          timeout
        })) {
          addCandidate(entry)
        }
      }
    }
    if (candidates.size === 0) {
      return []
    }

    // Why: enforce the gitignored-only contract for literal-derived candidates
    // too — a listed-but-not-ignored path must not be copied (issue #7549).
    const ignored = new Set(
      await checkIgnoredPaths(repoPath, Array.from(candidates.keys()), options)
    )
    return Array.from(candidates.keys())
      .filter((relativePath) => ignored.has(relativePath))
      .sort()
  } catch (error) {
    console.warn(`[worktree-include] Failed to resolve ${WORKTREE_INCLUDE_FILE} patterns:`, error)
    return []
  }
}
