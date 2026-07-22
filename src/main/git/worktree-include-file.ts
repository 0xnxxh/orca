import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { checkIgnoredPaths } from './check-ignored-paths'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'
import {
  isIncludedByWorktreePatterns,
  parseWorktreeIncludePatterns,
  WORKTREE_INCLUDE_MATCH_STEP_BUDGET,
  type WorktreeIncludePattern
} from './worktree-include-pattern'

/** Project-level list of gitignored paths to copy into each new worktree.
 *  Cross-tool convention (gitignore syntax); see issue #7549. */
export const WORKTREE_INCLUDE_FILE = '.worktreeinclude'

// Why: reading the include file must never delay worktree creation on a wedged
// filesystem or a pathological repo; bail and create the worktree without it.
const WORKTREE_INCLUDE_GIT_TIMEOUT_MS = 15_000
const WORKTREE_INCLUDE_MAX_FILE_BYTES = 256 * 1024
const WORKTREE_INCLUDE_MAX_CANDIDATES = 10_000
const WORKTREE_INCLUDE_MAX_CANDIDATE_BYTES = 1024 * 1024
// Why: Windows limits native command lines to 32K UTF-16 code units; leave
// room for Git's executable, fixed arguments, and the repository path.
const WORKTREE_INCLUDE_PATHSPEC_CHUNK_LENGTH = 12 * 1024

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
  fromIgnoredScan: boolean
}

function hasCandidateDirectoryAncestor(
  candidates: ReadonlyMap<string, GitignoredEntry>,
  relativePath: string
): boolean {
  let separatorIndex = relativePath.indexOf('/')
  while (separatorIndex !== -1) {
    const ancestor = candidates.get(relativePath.slice(0, separatorIndex))
    if (ancestor?.isDirectory && ancestor.fromIgnoredScan) {
      return true
    }
    separatorIndex = relativePath.indexOf('/', separatorIndex + 1)
  }
  return false
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
      isDirectory,
      fromIgnoredScan: true
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

function patternToGitDescendantPathspec(pattern: WorktreeIncludePattern): string {
  return `${patternToGitPathspec(pattern)}/**`
}

function chunkPathspecs(
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
    // A single impossible-to-match pattern must not exceed Windows' process
    // command-line limit; the collapsed scan still provides safe fallback.
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
    const matchBudget = { remaining: WORKTREE_INCLUDE_MATCH_STEP_BUDGET }
    const deadline = Date.now() + WORKTREE_INCLUDE_GIT_TIMEOUT_MS
    const addCandidate = (entry: GitignoredEntry): void => {
      if (
        isSafeIncludeCandidate(entry.relativePath) &&
        isIncludedByWorktreePatterns(patterns, entry.relativePath, entry.isDirectory, matchBudget)
      ) {
        if (hasCandidateDirectoryAncestor(candidates, entry.relativePath)) {
          return
        }
        if (
          !candidates.has(entry.relativePath) &&
          candidates.size >= WORKTREE_INCLUDE_MAX_CANDIDATES
        ) {
          throw new Error(`${WORKTREE_INCLUDE_FILE} matched too many paths`)
        }
        candidates.set(entry.relativePath, entry)
      }
    }

    // Why: anchored literals cannot be discovered more cheaply than a direct probe;
    // broad literals use the bounded Git scans below instead of serial filesystem I/O.
    const anchoredLiteralPaths = new Set(
      patterns
        .filter(
          (pattern) =>
            !pattern.negated &&
            !pattern.hasGlob &&
            pattern.anchored &&
            isSafeIncludeCandidate(pattern.body)
        )
        .map((pattern) => pattern.body)
    )
    for (const relativePath of anchoredLiteralPaths) {
      try {
        const stats = await lstat(join(repoPath, relativePath))
        addCandidate({
          relativePath,
          isDirectory: stats.isDirectory(),
          fromIgnoredScan: false
        })
      } catch {
        // Absent in the primary checkout — nothing to copy.
      }
    }

    const broadPatterns = patterns.filter(
      (pattern) => !pattern.negated && (pattern.hasGlob || !pattern.anchored)
    )
    if (broadPatterns.length > 0) {
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
      const filePathspecs = broadPatterns.flatMap((pattern) => [
        ...(pattern.dirOnly ? [] : [patternToGitPathspec(pattern)]),
        // Why: files beneath a matching directory expose directory matches that
        // Git 2.25 otherwise hides behind a collapsed ignored parent.
        patternToGitDescendantPathspec(pattern)
      ])
      // Why: collapsed directories are already copied as units; excluding them
      // keeps a targeted nested scan from expanding node_modules-scale trees.
      const coveredDirectoryPathspecs = Array.from(candidates.values())
        .filter((entry) => entry.isDirectory && entry.fromIgnoredScan)
        .map((entry) => `:(exclude,literal)${entry.relativePath}`)
      for (const pathspecs of chunkPathspecs(filePathspecs, coveredDirectoryPathspecs)) {
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

    const candidatePaths = Array.from(candidates.keys())
    if (
      candidatePaths.reduce(
        (bytes, relativePath) => bytes + Buffer.byteLength(relativePath) + 1,
        0
      ) > WORKTREE_INCLUDE_MAX_CANDIDATE_BYTES
    ) {
      throw new Error(`${WORKTREE_INCLUDE_FILE} matched paths exceed its byte budget`)
    }
    const checkIgnoreTimeout = deadline - Date.now()
    if (checkIgnoreTimeout <= 0) {
      throw new Error(`${WORKTREE_INCLUDE_FILE} resolution timed out`)
    }

    // Why: enforce the gitignored-only contract for literal-derived candidates
    // too — a listed-but-not-ignored path must not be copied (issue #7549).
    const ignored = new Set(
      await checkIgnoredPaths(repoPath, candidatePaths, options, checkIgnoreTimeout)
    )
    return candidatePaths.filter((relativePath) => ignored.has(relativePath)).sort()
  } catch (error) {
    console.warn(`[worktree-include] Failed to resolve ${WORKTREE_INCLUDE_FILE} patterns:`, error)
    return []
  }
}
