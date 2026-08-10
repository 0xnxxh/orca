export type CacheOnlyGitHubIssueRefreshTriggerState = {
  pairedWebCatalogKey: string | null
  spaceCatalogKey: string | null
}

export const INITIAL_CACHE_ONLY_GITHUB_ISSUE_REFRESH_TRIGGER_STATE: CacheOnlyGitHubIssueRefreshTriggerState =
  {
    pairedWebCatalogKey: null,
    spaceCatalogKey: null
  }

type GitHubIssueCatalogWorktree = {
  repoId: string
  linkedIssue?: number | null
  hostId?: string
  runtimeOwnerEnvironmentId?: string
}

const githubIssueCatalogKeyCache = new WeakMap<object, string>()
const githubIssueCatalogWorktreeKeyCache = new WeakMap<object, string>()
const githubIssueCatalogListKeysCache = new WeakMap<object, readonly string[]>()

function getGitHubIssueCatalogWorktreeKey(worktree: GitHubIssueCatalogWorktree): string {
  const cached = githubIssueCatalogWorktreeKeyCache.get(worktree)
  if (cached !== undefined) {
    return cached
  }
  const linkedIssue = worktree.linkedIssue
  const runtimeOwner = worktree.runtimeOwnerEnvironmentId?.trim()
  const key = linkedIssue
    ? JSON.stringify([
        worktree.repoId,
        runtimeOwner ? `runtime:${runtimeOwner}` : (worktree.hostId ?? ''),
        linkedIssue
      ])
    : ''
  githubIssueCatalogWorktreeKeyCache.set(worktree, key)
  return key
}

function getGitHubIssueCatalogListKeys(
  worktrees: readonly GitHubIssueCatalogWorktree[]
): readonly string[] {
  const cached = githubIssueCatalogListKeysCache.get(worktrees)
  if (cached !== undefined) {
    return cached
  }
  const keys = new Set<string>()
  for (const worktree of worktrees) {
    const key = getGitHubIssueCatalogWorktreeKey(worktree)
    if (key) {
      keys.add(key)
    }
  }
  const result = [...keys]
  githubIssueCatalogListKeysCache.set(worktrees, result)
  return result
}

export function getCacheOnlyGitHubIssueCatalogKey(
  worktreesByRepo: Readonly<Record<string, readonly GitHubIssueCatalogWorktree[]>>
): string {
  const cached = githubIssueCatalogKeyCache.get(worktreesByRepo)
  if (cached !== undefined) {
    return cached
  }
  const issueOwners = new Set<string>()
  for (const worktrees of Object.values(worktreesByRepo)) {
    for (const key of getGitHubIssueCatalogListKeys(worktrees)) {
      issueOwners.add(key)
    }
  }
  const key = [...issueOwners].sort().join('\n')
  githubIssueCatalogKeyCache.set(worktreesByRepo, key)
  return key
}

export function advanceCacheOnlyGitHubIssueRefreshTrigger(
  state: CacheOnlyGitHubIssueRefreshTriggerState,
  input: {
    startupWorktreeRefreshCompleted: boolean
    issueCatalogKey: string
    pairedWebEligible: boolean
    spaceActive: boolean
    windowVisible: boolean
  }
): { state: CacheOnlyGitHubIssueRefreshTriggerState; shouldRefresh: boolean } {
  if (!input.startupWorktreeRefreshCompleted) {
    return {
      state: INITIAL_CACHE_ONLY_GITHUB_ISSUE_REFRESH_TRIGGER_STATE,
      shouldRefresh: false
    }
  }
  const shouldRefreshPairedWeb =
    input.windowVisible &&
    input.pairedWebEligible &&
    state.pairedWebCatalogKey !== input.issueCatalogKey &&
    (input.issueCatalogKey.length > 0 || state.pairedWebCatalogKey !== null)
  const shouldRefreshSpace =
    input.windowVisible &&
    input.spaceActive &&
    state.spaceCatalogKey !== input.issueCatalogKey &&
    (input.issueCatalogKey.length > 0 || state.spaceCatalogKey !== null)
  return {
    state: {
      pairedWebCatalogKey: input.pairedWebEligible ? input.issueCatalogKey : null,
      spaceCatalogKey: input.spaceActive ? input.issueCatalogKey : null
    },
    shouldRefresh: shouldRefreshPairedWeb || shouldRefreshSpace
  }
}
