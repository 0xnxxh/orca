import type { GitRepositorySnapshotSubscriptionEvent } from './git-repository-snapshot'
import type { GitPushTarget } from './types'

export type RuntimeGitRepositorySnapshotRevisionRequest = {
  worktree: string
  includeIgnored?: boolean
  bypassEffectiveUpstreamNegativeCache?: boolean
  reuseLineStats?: boolean
  pushTarget?: GitPushTarget
}

export type RuntimeGitRepositorySnapshotRevisionMessage =
  | Readonly<{ type: 'subscribed'; subscriptionId: string; incarnation: number }>
  | Readonly<{ type: 'revision'; event: GitRepositorySnapshotSubscriptionEvent }>
  | Readonly<{ type: 'end' }>
