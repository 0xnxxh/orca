import { getRepoExecutionHostId, type ExecutionHostId } from '../shared/execution-host'
import type { Repo } from '../shared/repo-types'
import type { WorktreeMeta } from '../shared/worktree/meta-types'

export type WorktreeRemovalRepoSource = {
  getRepos: () => readonly Repo[]
  getRepo: (repoId: string) => Repo | undefined
}

export type WorktreeRemovalRepoOwner =
  | { kind: 'resolved'; repo: Repo }
  | { kind: 'ambiguous' }
  | { kind: 'missing' }

/**
 * Which repo a destructive worktree removal belongs to.
 *
 * A repo id can be registered once per execution host. Destructive RPC callers
 * reject a missing host before reaching this resolver; the unqualified branch
 * remains only for direct legacy callers and still refuses multiple owners.
 */
export function resolveWorktreeRemovalRepoOwner(
  store: WorktreeRemovalRepoSource,
  repoId: string,
  hostId?: ExecutionHostId
): WorktreeRemovalRepoOwner {
  const matches = store
    .getRepos()
    .filter((repo) => repo.id === repoId && (!hostId || getRepoExecutionHostId(repo) === hostId))
  if (matches.length === 1 && matches[0]) {
    return { kind: 'resolved', repo: matches[0] }
  }
  if (matches.length > 1) {
    return { kind: 'ambiguous' }
  }
  const legacyMatch = store.getRepo(repoId)
  return legacyMatch && (!hostId || getRepoExecutionHostId(legacyMatch) === hostId)
    ? { kind: 'resolved', repo: legacyMatch }
    : { kind: 'missing' }
}

export function hasWorktreeRemovalRepoOwnerOnOtherHost(
  store: Pick<WorktreeRemovalRepoSource, 'getRepos'>,
  repoId: string,
  hostId: ExecutionHostId
): boolean {
  return store
    .getRepos()
    .some((repo) => repo.id === repoId && getRepoExecutionHostId(repo) !== hostId)
}

export function resolveWorktreeRemovalMetadata(
  store: Pick<WorktreeRemovalRepoSource, 'getRepos'> & {
    getWorktreeMeta: (worktreeId: string) => WorktreeMeta | undefined
  },
  repoId: string,
  worktreeId: string,
  hostId: ExecutionHostId
): WorktreeMeta | undefined {
  const meta = store.getWorktreeMeta(worktreeId)
  if (!meta) {
    return undefined
  }
  const repoOwnerCount = store.getRepos().filter((repo) => repo.id === repoId).length
  if (repoOwnerCount <= 1) {
    return meta
  }
  return meta.hostId === hostId ? meta : undefined
}
