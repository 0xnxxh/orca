import type { GitStatusEntry, GitStatusResult, Repo } from '../../shared/types'
import { isFolderRepo } from '../../shared/repo-kind'
import {
  isPathInsideOrEqual,
  normalizeRuntimePathForComparison,
  relativePathInsideRoot,
  resolveRuntimePath
} from '../../shared/cross-platform-path'

/**
 * A folder workspace is a container directory that is not itself a git repo; the
 * real repos live inside it. Git operations addressed to the workspace selector
 * must be routed to whichever child repo owns the requested path.
 */
export function listFolderWorkspaceChildRepos(repos: readonly Repo[], folderPath: string): Repo[] {
  const matching = repos
    .filter(
      (candidate) => !isFolderRepo(candidate) && isPathInsideOrEqual(folderPath, candidate.path)
    )
    .filter((candidate) => relativePathInsideRoot(folderPath, candidate.path) !== '')
    .sort((left, right) => right.path.length - left.path.length)
  // Why: the same directory can be registered twice (imported once directly and
  // once by a folder scan). Without this the merged status lists every file twice
  // and a commit runs against the repo twice.
  const byPath = new Map<string, Repo>()
  for (const repo of matching) {
    const key = normalizeRuntimePathForComparison(repo.path)
    if (!byPath.has(key)) {
      byPath.set(key, repo)
    }
  }
  return [...byPath.values()]
}

export type FolderWorkspaceChildRepoMatch = {
  repo: Repo
  /** `relativePath` rebased to be relative to `repo.path`. */
  rebasedRelativePath: string
}

/**
 * Resolve which child repo owns `relativePath` (given relative to the workspace
 * folder). Deepest match wins so a nested repo beats its ancestor.
 */
export function matchFolderWorkspaceChildRepo(
  repos: readonly Repo[],
  folderPath: string,
  relativePath: string | undefined
): FolderWorkspaceChildRepoMatch | null {
  if (!relativePath) {
    return null
  }
  const absolutePath = resolveRuntimePath(folderPath, relativePath)
  // Why: a `..` segment must not silently resolve to a repo the user never opened.
  // Defense-in-depth today — the loop below only considers repos already inside
  // `folderPath`, so anything it could match is inside the folder anyway. This
  // stops that from being load-bearing if the candidate filter ever widens.
  if (relativePathInsideRoot(folderPath, absolutePath) === null) {
    return null
  }
  for (const repo of listFolderWorkspaceChildRepos(repos, folderPath)) {
    if (!isPathInsideOrEqual(repo.path, absolutePath)) {
      continue
    }
    const rebasedRelativePath = relativePathInsideRoot(repo.path, absolutePath)
    if (rebasedRelativePath === null || rebasedRelativePath === '') {
      continue
    }
    return { repo, rebasedRelativePath }
  }
  return null
}

/**
 * Combine per-child-repo results for an op that has no path to route on. Every
 * child either succeeded or reports why it did not, so a partial outcome is
 * described rather than reported as one blanket success or failure.
 */
export function summarizeFolderWorkspaceFanOut(
  results: readonly { repoName: string; error?: string }[]
): { success: boolean; error?: string } {
  const failures = results.filter((result) => result.error !== undefined)
  if (failures.length === 0) {
    return { success: true }
  }
  // Why: naming the repo matters most when only some of them failed — the user
  // has to know which ones still need attention.
  const detail = failures.map((failure) => `${failure.repoName}: ${failure.error}`).join('; ')
  if (failures.length === results.length) {
    return { success: false, error: detail }
  }
  const succeeded = results.length - failures.length
  return {
    success: false,
    error: `Committed ${succeeded} of ${results.length} repos. Failed — ${detail}`
  }
}

/** Prefix a child repo's status entry path so it stays addressable from the workspace root. */
export function prefixFolderWorkspaceEntryPath(
  folderPath: string,
  repoPath: string,
  entryPath: string
): string {
  const repoPrefix = relativePathInsideRoot(folderPath, repoPath)
  return repoPrefix ? `${repoPrefix}/${entryPath}` : entryPath
}

/**
 * Merge per-child-repo status into one workspace-level result. Entry paths are
 * rewritten workspace-relative so the renderer can address them with the same
 * selector it listed them under.
 */
export function mergeFolderWorkspaceGitStatus(
  folderPath: string,
  perRepo: readonly { repo: Repo; status: GitStatusResult }[]
): GitStatusResult {
  const entries: GitStatusEntry[] = []
  const ignoredPaths: string[] = []
  let didHitLimit = false
  let statusLength = 0
  for (const { repo, status } of perRepo) {
    const rebase = (path: string): string =>
      prefixFolderWorkspaceEntryPath(folderPath, repo.path, path)
    for (const entry of status.entries) {
      entries.push({
        ...entry,
        path: rebase(entry.path),
        ...(entry.oldPath ? { oldPath: rebase(entry.oldPath) } : {}),
        ...(entry.submoduleRoot ? { submoduleRoot: rebase(entry.submoduleRoot) } : {})
      })
    }
    for (const ignored of status.ignoredPaths ?? []) {
      ignoredPaths.push(rebase(ignored))
    }
    didHitLimit ||= status.didHitLimit === true
    statusLength += status.statusLength ?? status.entries.length
  }
  return {
    entries,
    // Why: no single HEAD/branch/upstream describes N repos, so those stay unset
    // rather than reporting one child's state as the whole workspace's.
    conflictOperation:
      perRepo.find(({ status }) => status.conflictOperation !== 'unknown')?.status
        .conflictOperation ?? 'unknown',
    ...(ignoredPaths.length > 0 ? { ignoredPaths } : {}),
    ...(didHitLimit ? { didHitLimit: true } : {}),
    statusLength
  }
}
