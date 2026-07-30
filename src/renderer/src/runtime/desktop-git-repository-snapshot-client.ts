import type { GitPushTarget } from '../../../shared/types'
import type { GitRepositorySnapshot } from '../../../shared/git-repository-snapshot'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree-id'
import { getActiveRuntimeTarget } from './runtime-rpc-client'
import type { RuntimeGitContext } from './runtime-git-client'

function resolveDesktopSnapshotWorktreePath(context: RuntimeGitContext): string {
  return context.worktreeId
    ? (splitWorktreeIdForFilesystem(context.worktreeId)?.worktreePath ?? context.worktreePath)
    : context.worktreePath
}

export async function getDesktopGitRepositorySnapshot(
  context: RuntimeGitContext,
  options: {
    includeIgnored?: boolean
    bypassEffectiveUpstreamNegativeCache?: boolean
    reuseLineStats?: boolean
    pushTarget?: GitPushTarget
  } = {}
): Promise<GitRepositorySnapshot | null> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind !== 'local' && context.worktreeId) {
    return null
  }
  return window.api.git.repositorySnapshot({
    worktreePath: resolveDesktopSnapshotWorktreePath(context),
    connectionId: context.connectionId,
    ...(options.includeIgnored ? { includeIgnored: true } : {}),
    ...(options.bypassEffectiveUpstreamNegativeCache
      ? { bypassEffectiveUpstreamNegativeCache: true }
      : {}),
    ...(options.reuseLineStats ? { reuseLineStats: true } : {}),
    ...(options.pushTarget ? { pushTarget: options.pushTarget } : {})
  })
}
