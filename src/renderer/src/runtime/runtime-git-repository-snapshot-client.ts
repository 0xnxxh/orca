import type { GitRepositorySnapshot } from '../../../shared/git-repository-snapshot'
import type { GitPushTarget } from '../../../shared/types'
import {
  getDesktopGitRepositorySnapshot,
  type DesktopGitRepositorySnapshotContext
} from './desktop-git-repository-snapshot-client'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'

export type RuntimeGitRepositorySnapshotOptions = {
  includeIgnored?: boolean
  bypassEffectiveUpstreamNegativeCache?: boolean
  reuseLineStats?: boolean
  pushTarget?: GitPushTarget
}

export async function getRuntimeGitRepositorySnapshot(
  context: DesktopGitRepositorySnapshotContext,
  options: RuntimeGitRepositorySnapshotOptions = {}
): Promise<GitRepositorySnapshot | null> {
  const target = getActiveRuntimeTarget(context.settings)
  try {
    if (target.kind === 'local' || !context.worktreeId) {
      return await getDesktopGitRepositorySnapshot(context, options)
    }
    return await callRuntimeRpc<GitRepositorySnapshot | null>(
      target,
      'git.repositorySnapshot',
      {
        worktree: toRuntimeWorktreeSelector(context.worktreeId),
        ...(options.includeIgnored ? { includeIgnored: true } : {}),
        ...(options.bypassEffectiveUpstreamNegativeCache
          ? { bypassEffectiveUpstreamNegativeCache: true }
          : {}),
        ...(options.reuseLineStats ? { reuseLineStats: true } : {}),
        ...(options.pushTarget ? { pushTarget: options.pushTarget } : {})
      },
      { timeoutMs: 15_000 }
    )
  } catch {
    return null
  }
}
