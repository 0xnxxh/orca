import type { GitPushTarget } from '../../../shared/types'
import type {
  GitRepositorySnapshot,
  GitRepositorySnapshotRequest,
  GitRepositorySnapshotSubscriptionEvent
} from '../../../shared/git-repository-snapshot'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree-id'
import { getActiveRuntimeTarget } from './runtime-rpc-client'
import type { RuntimeGitContext } from './runtime-git-client'

export type DesktopGitRepositorySnapshotContext = RuntimeGitContext

function resolveDesktopSnapshotWorktreePath(context: RuntimeGitContext): string {
  return context.worktreeId
    ? (splitWorktreeIdForFilesystem(context.worktreeId)?.worktreePath ?? context.worktreePath)
    : context.worktreePath
}

function createDesktopSnapshotRequest(
  context: RuntimeGitContext,
  options: {
    includeIgnored?: boolean
    bypassEffectiveUpstreamNegativeCache?: boolean
    reuseLineStats?: boolean
    pushTarget?: GitPushTarget
  }
): GitRepositorySnapshotRequest {
  return {
    worktreePath: resolveDesktopSnapshotWorktreePath(context),
    connectionId: context.connectionId,
    ...(options.includeIgnored ? { includeIgnored: true } : {}),
    ...(options.bypassEffectiveUpstreamNegativeCache
      ? { bypassEffectiveUpstreamNegativeCache: true }
      : {}),
    ...(options.reuseLineStats ? { reuseLineStats: true } : {}),
    ...(options.pushTarget ? { pushTarget: options.pushTarget } : {})
  }
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
  return window.api.git.repositorySnapshot(createDesktopSnapshotRequest(context, options))
}

export async function subscribeDesktopGitRepositorySnapshot(
  context: RuntimeGitContext,
  options: {
    includeIgnored?: boolean
    bypassEffectiveUpstreamNegativeCache?: boolean
    reuseLineStats?: boolean
    pushTarget?: GitPushTarget
  },
  callback: (event: GitRepositorySnapshotSubscriptionEvent) => void
): Promise<{ unsubscribe: () => void } | null> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind !== 'local' && context.worktreeId) {
    return null
  }
  return window.api.git.subscribeRepositorySnapshot(
    createDesktopSnapshotRequest(context, options),
    callback
  )
}
