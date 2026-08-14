import { getRepoExecutionHostId, type ExecutionHostId } from '../shared/execution-host'
import type { Repo } from '../shared/repo-types'

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
 * A repo id can be registered once per execution host, so an unqualified call —
 * an older client that cannot send `hostId` — is only safe while exactly one
 * host owns it. Two owners resolve to `ambiguous` so the caller fails closed
 * instead of deleting a same-id workspace on the wrong host (STA-4343).
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
