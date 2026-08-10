import type { GlobalSettings, Repo, Worktree } from '../../../../shared/types'
import {
  LOCAL_EXECUTION_HOST_ID,
  getRepoExecutionHostId,
  getSettingsFocusedExecutionHostId,
  parseExecutionHostId,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'

type RepoIdentityParts = Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>
type WorktreeRepoOwnerParts = Pick<Worktree, 'repoId' | 'hostId' | 'runtimeOwnerEnvironmentId'>

const uniqueRuntimeRepoIndexCache = new WeakMap<
  ReadonlyMap<string, RepoIdentityParts>,
  ReadonlyMap<string, RepoIdentityParts>
>()

function getUniqueRuntimeRepoIndex<T extends RepoIdentityParts>(
  repoByHostIdentity: ReadonlyMap<string, T>
): ReadonlyMap<string, T> {
  const cached = uniqueRuntimeRepoIndexCache.get(repoByHostIdentity)
  if (cached) {
    return cached as ReadonlyMap<string, T>
  }

  const uniqueRuntimeRepoById = new Map<string, T>()
  const ambiguousRepoIds = new Set<string>()
  for (const repo of repoByHostIdentity.values()) {
    if (
      ambiguousRepoIds.has(repo.id) ||
      parseExecutionHostId(getRepoExecutionHostId(repo))?.kind !== 'runtime'
    ) {
      continue
    }
    if (uniqueRuntimeRepoById.delete(repo.id)) {
      ambiguousRepoIds.add(repo.id)
    } else {
      uniqueRuntimeRepoById.set(repo.id, repo)
    }
  }
  uniqueRuntimeRepoIndexCache.set(repoByHostIdentity, uniqueRuntimeRepoById)
  return uniqueRuntimeRepoById
}

export function getRepoHostIdentity(repo: RepoIdentityParts): string {
  return getRepoHostIdentityForParts(repo.id, getRepoExecutionHostId(repo))
}

export function getRepoHostIdentityForParts(repoId: string, hostId: string): string {
  // Why: host ids and repo ids can contain punctuation; NUL keeps the composite
  // key collision-free without escaping user/provider-owned strings.
  return `${hostId}\0${repoId}`
}

export function repoMatchesHostIdentity(
  repo: RepoIdentityParts,
  repoId: string,
  hostId: string
): boolean {
  return repo.id === repoId && getRepoExecutionHostId(repo) === hostId
}

export function findRepoForWorktreeHostIdentity<T extends RepoIdentityParts>(
  worktree: WorktreeRepoOwnerParts,
  repoById: ReadonlyMap<string, T>,
  repoByHostIdentity: ReadonlyMap<string, T>,
  defaultHostId: ExecutionHostId = LOCAL_EXECUTION_HOST_ID
): T | undefined {
  const runtimeOwnerEnvironmentId = worktree.runtimeOwnerEnvironmentId?.trim()
  const explicitOwnerHostId = runtimeOwnerEnvironmentId
    ? toRuntimeExecutionHostId(runtimeOwnerEnvironmentId)
    : worktree.hostId
  const indexedOwner = repoByHostIdentity.get(
    getRepoHostIdentityForParts(worktree.repoId, explicitOwnerHostId ?? defaultHostId)
  )
  if (indexedOwner || !explicitOwnerHostId) {
    return indexedOwner ?? repoById.get(worktree.repoId)
  }
  if (runtimeOwnerEnvironmentId || parseExecutionHostId(explicitOwnerHostId)?.kind !== 'ssh') {
    return undefined
  }
  return getUniqueRuntimeRepoIndex(repoByHostIdentity).get(worktree.repoId)
}

export function findRepoForHost<T extends RepoIdentityParts>(
  repos: readonly T[],
  repoId: string,
  options: {
    hostId?: ExecutionHostId | string | null
    settings?: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null
  } = {}
): T | null {
  const matchingRepos = repos.filter((repo) => repo.id === repoId)
  if (matchingRepos.length === 0) {
    return null
  }

  if (options.hostId) {
    return matchingRepos.find((repo) => getRepoExecutionHostId(repo) === options.hostId) ?? null
  }

  if (matchingRepos.length === 1) {
    return matchingRepos[0]
  }

  const focusedHostId = getSettingsFocusedExecutionHostId(options.settings)
  const focusedMatches = matchingRepos.filter(
    (repo) => getRepoExecutionHostId(repo) === focusedHostId
  )
  // Why: when duplicate ids exist even within the focused host, mutating by bare
  // id would be ambiguous. Let callers surface no owner instead of guessing.
  return focusedMatches.length === 1 ? focusedMatches[0] : null
}

export function findRepoForWorktreeOwner<T extends RepoIdentityParts>(
  repos: readonly T[],
  worktree: WorktreeRepoOwnerParts,
  settings?: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null
): T | null {
  const runtimeOwnerEnvironmentId = worktree.runtimeOwnerEnvironmentId?.trim()
  const runtimeOwnerHostId = runtimeOwnerEnvironmentId
    ? toRuntimeExecutionHostId(runtimeOwnerEnvironmentId)
    : undefined
  const owner = findRepoForHost(repos, worktree.repoId, {
    hostId: runtimeOwnerHostId ?? worktree.hostId,
    settings
  })
  if (owner || runtimeOwnerHostId || parseExecutionHostId(worktree.hostId)?.kind !== 'ssh') {
    return owner
  }
  const pairedRuntimeRepos = repos.filter(
    (repo) => parseExecutionHostId(getRepoExecutionHostId(repo))?.kind === 'runtime'
  )
  return pairedRuntimeRepos.length === 1 ? pairedRuntimeRepos[0] : null
}
