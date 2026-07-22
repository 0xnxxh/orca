import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { checkIgnoredPaths } from './check-ignored-paths'
import type { GitRuntimeOptions } from './git-runtime-options'
import {
  chunkWorktreeIncludePathspecs,
  listGitignoredEntries,
  worktreeIncludePatternToGitDescendantPathspec,
  worktreeIncludePatternToGitPathspec,
  type GitignoredEntry
} from './worktree-include-git-enumeration'
import {
  isIncludedByWorktreePatterns,
  parseWorktreeIncludePatterns,
  WORKTREE_INCLUDE_MATCH_STEP_BUDGET,
  type WorktreeIncludePattern
} from './worktree-include-pattern'
import { mapWithConcurrency } from '../../shared/map-with-concurrency'

/** Project-level list of gitignored paths to copy into each new worktree.
 *  Cross-tool convention (gitignore syntax); see issue #7549. */
export const WORKTREE_INCLUDE_FILE = '.worktreeinclude'

// Why: reading the include file must never delay worktree creation on a wedged
// filesystem or a pathological repo; bail and create the worktree without it.
const WORKTREE_INCLUDE_GIT_TIMEOUT_MS = 15_000
const WORKTREE_INCLUDE_MAX_FILE_BYTES = 256 * 1024
const WORKTREE_INCLUDE_MAX_CANDIDATES = 10_000
const WORKTREE_INCLUDE_MAX_CANDIDATE_BYTES = 1024 * 1024
const WORKTREE_INCLUDE_STAT_CONCURRENCY = 8

function isSafeIncludeCandidate(relativePath: string): boolean {
  if (!relativePath || isAbsolute(relativePath)) {
    return false
  }
  const segments = relativePath.split(/[\\/]/)
  return !segments.includes('..') && segments[0] !== '.git'
}

function hasCandidateDirectoryAncestor(
  candidates: ReadonlyMap<string, GitignoredEntry>,
  relativePath: string
): boolean {
  let separatorIndex = relativePath.indexOf('/')
  while (separatorIndex !== -1) {
    const ancestor = candidates.get(relativePath.slice(0, separatorIndex))
    if (ancestor?.isDirectory && ancestor.coversDescendants) {
      return true
    }
    separatorIndex = relativePath.indexOf('/', separatorIndex + 1)
  }
  return false
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
    const anchoredLiteralPatterns = new Map(
      patterns
        .filter(
          (pattern) =>
            !pattern.negated &&
            !pattern.hasGlob &&
            pattern.anchored &&
            isSafeIncludeCandidate(pattern.body)
        )
        .map((pattern) => [pattern.body, pattern] as const)
    )
    const anchoredLiteralDirectories = new Map<string, WorktreeIncludePattern>()
    // Why: thousands of serial UNC/WSL stats can stall creation, while unbounded fanout can swamp the filesystem.
    const anchoredLiteralStats = await mapWithConcurrency(
      Array.from(anchoredLiteralPatterns),
      WORKTREE_INCLUDE_STAT_CONCURRENCY,
      async ([relativePath, pattern]) => {
        try {
          const stats = await lstat(join(repoPath, relativePath))
          return { relativePath, pattern, isDirectory: stats.isDirectory() }
        } catch {
          return null
        }
      }
    )
    for (const result of anchoredLiteralStats) {
      if (result) {
        const { relativePath, pattern, isDirectory } = result
        addCandidate({
          relativePath,
          isDirectory,
          coversDescendants: false
        })
        if (isDirectory && candidates.has(relativePath)) {
          anchoredLiteralDirectories.set(relativePath, pattern)
        }
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
    }

    // Why: an anchored directory can contain tracked files while only some descendants are ignored; only fully ignored directories are safe to copy as one unit.
    const checkedAnchoredDirectories = new Set(anchoredLiteralDirectories.keys())
    const ignoredAnchoredDirectories = new Set<string>()
    const anchoredDirectoriesToCheck: string[] = []
    for (const relativePath of checkedAnchoredDirectories) {
      if (candidates.get(relativePath)?.coversDescendants) {
        ignoredAnchoredDirectories.add(relativePath)
      } else {
        anchoredDirectoriesToCheck.push(relativePath)
      }
    }
    if (anchoredDirectoriesToCheck.length > 0) {
      const timeout = deadline - Date.now()
      if (timeout <= 0) {
        throw new Error(`${WORKTREE_INCLUDE_FILE} resolution timed out`)
      }
      for (const relativePath of await checkIgnoredPaths(
        repoPath,
        anchoredDirectoriesToCheck,
        options,
        timeout
      )) {
        ignoredAnchoredDirectories.add(relativePath)
        const candidate = candidates.get(relativePath)
        if (candidate?.isDirectory) {
          candidate.coversDescendants = true
        }
      }
    }

    // Why: Git 2.25's directory collapsing can stop at an untracked parent, so targeted scans preserve nested matches without expanding unrelated ignored trees.
    const filePathspecs = [
      ...broadPatterns.flatMap((pattern) => [
        ...(pattern.dirOnly ? [] : [worktreeIncludePatternToGitPathspec(pattern)]),
        // Why: files beneath a matching directory expose directory matches that
        // Git 2.25 otherwise hides behind a collapsed ignored parent.
        worktreeIncludePatternToGitDescendantPathspec(pattern)
      ]),
      ...Array.from(anchoredLiteralDirectories.entries())
        .filter(([relativePath]) => !ignoredAnchoredDirectories.has(relativePath))
        .map(([, pattern]) => worktreeIncludePatternToGitDescendantPathspec(pattern))
    ]
    if (filePathspecs.length > 0) {
      // Why: collapsed directories are already copied as units; excluding them
      // keeps a targeted nested scan from expanding node_modules-scale trees.
      const coveredDirectoryPathspecs = Array.from(candidates.values())
        .filter((entry) => entry.isDirectory && entry.coversDescendants)
        .map((entry) => `:(exclude,literal)${entry.relativePath}`)
      for (const pathspecs of chunkWorktreeIncludePathspecs(
        filePathspecs,
        coveredDirectoryPathspecs
      )) {
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
    // Why: enforce the gitignored-only contract for literal-derived candidates
    // too — a listed-but-not-ignored path must not be copied (issue #7549).
    const ignored = new Set(ignoredAnchoredDirectories)
    const uncheckedCandidatePaths = candidatePaths.filter(
      (relativePath) => !checkedAnchoredDirectories.has(relativePath)
    )
    if (uncheckedCandidatePaths.length > 0) {
      const timeout = deadline - Date.now()
      if (timeout <= 0) {
        throw new Error(`${WORKTREE_INCLUDE_FILE} resolution timed out`)
      }
      for (const relativePath of await checkIgnoredPaths(
        repoPath,
        uncheckedCandidatePaths,
        options,
        timeout
      )) {
        ignored.add(relativePath)
      }
    }
    return candidatePaths.filter((relativePath) => ignored.has(relativePath)).sort()
  } catch (error) {
    console.warn(`[worktree-include] Failed to resolve ${WORKTREE_INCLUDE_FILE} patterns:`, error)
    return []
  }
}
