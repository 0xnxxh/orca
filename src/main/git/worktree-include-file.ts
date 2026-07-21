import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { checkIgnoredPaths } from './check-ignored-paths'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'

/** Project-level list of gitignored paths to copy into each new worktree.
 *  Cross-tool convention (gitignore syntax); see issue #7549. */
export const WORKTREE_INCLUDE_FILE = '.worktreeinclude'

// Why: reading the include file must never delay worktree creation on a wedged
// filesystem or a pathological repo; bail and create the worktree without it.
const WORKTREE_INCLUDE_GIT_TIMEOUT_MS = 15_000
const WORKTREE_INCLUDE_MAX_FILE_BYTES = 256 * 1024

type WorktreeIncludePattern = {
  negated: boolean
  /** Pattern with `!`, leading `/`, and trailing `/` stripped. */
  body: string
  dirOnly: boolean
  anchored: boolean
  hasGlob: boolean
  regExp: RegExp | null
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
      regExp: hasGlob ? gitignoreGlobToRegExp(trimmed) : null
    })
  }
  return patterns
}

// Why: `[...]` character classes are intentionally treated as literals — the
// glob subset here mirrors what git itself matches for the overwhelmingly
// common `.env.*` / `**/secrets` shapes without risking a bad user pattern
// becoming an invalid or pathological RegExp.
function gitignoreGlobToRegExp(pattern: string): RegExp | null {
  let regex = ''
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        regex += '.*'
        index++
        // Collapse `**/` so `foo/**/bar` also matches `foo/bar`.
        if (pattern[index + 1] === '/') {
          regex += '/?'
          index++
        }
      } else {
        regex += '[^/]*'
      }
    } else if (char === '?') {
      regex += '[^/]'
    } else {
      regex += char.replace(/[.+^${}()|[\]\\]/, '\\$&')
    }
  }
  try {
    return new RegExp(`^${regex}$`)
  } catch {
    return null
  }
}

function patternMatches(
  pattern: WorktreeIncludePattern,
  relativePath: string,
  isDirectory: boolean
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
  return pattern.regExp !== null && pattern.regExp.test(subject)
}

function isIncludedByPatterns(
  patterns: readonly WorktreeIncludePattern[],
  relativePath: string,
  isDirectory: boolean
): boolean {
  // Why: gitignore semantics — the last matching pattern wins, so `!` lines
  // can carve exceptions out of an earlier broad include.
  let included = false
  for (const pattern of patterns) {
    if (patternMatches(pattern, relativePath, isDirectory)) {
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

/** Untracked gitignored files/dirs at directory granularity. `--directory`
 *  collapses wholly-ignored dirs (e.g. `node_modules/`) into one entry and
 *  prunes traversal beneath them, keeping this fast in huge repos. */
async function listGitignoredEntries(
  repoPath: string,
  options: GitRuntimeOptions
): Promise<GitignoredEntry[]> {
  const { stdout } = await gitExecFileAsync(
    [
      '-c',
      'core.quotePath=false',
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
      '-z'
    ],
    {
      ...gitOptionsForWorktree(repoPath, options),
      timeout: WORKTREE_INCLUDE_GIT_TIMEOUT_MS
    }
  )
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
    const addCandidate = (entry: GitignoredEntry): void => {
      if (
        isSafeIncludeCandidate(entry.relativePath) &&
        isIncludedByPatterns(patterns, entry.relativePath, entry.isDirectory)
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

    // Glob patterns match against the collapsed gitignored entry list; run the
    // enumeration only when a glob is actually present.
    if (patterns.some((pattern) => !pattern.negated && pattern.hasGlob)) {
      for (const entry of await listGitignoredEntries(repoPath, options)) {
        addCandidate(entry)
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
