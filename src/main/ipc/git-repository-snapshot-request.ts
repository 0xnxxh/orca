import type { GitRepositorySnapshotRequest } from '../../shared/git-repository-snapshot'
import type { Store } from '../persistence'
import type { GetStatusOptions } from '../git/status'
import { getWorktreeSharedLinkPaths } from '../git/worktree-shared-directories'
import { resolveRegisteredWorktreePath } from './filesystem-auth'
import {
  getLocalGitOptionsForRepo,
  getLocalRepoForRegisteredWorktree
} from './local-worktree-runtime-options'

export async function resolveLocalGitRepositorySnapshotRequest(
  store: Store,
  args: GitRepositorySnapshotRequest
): Promise<{ worktreePath: string; options: GetStatusOptions }> {
  const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
  const repo = getLocalRepoForRegisteredWorktree(store, args.worktreePath, worktreePath)
  const sharedLinkPaths = repo ? getWorktreeSharedLinkPaths(repo) : []
  return {
    worktreePath,
    options: {
      includeIgnored: args.includeIgnored ?? false,
      ...(args.reuseLineStats === true ? { reuseLineStats: true } : {}),
      ...(args.bypassEffectiveUpstreamNegativeCache === true
        ? { bypassEffectiveUpstreamNegativeCache: true }
        : {}),
      ...getLocalGitOptionsForRepo(store, repo),
      ...(sharedLinkPaths.length > 0 ? { sharedLinkPaths } : {})
    }
  }
}
