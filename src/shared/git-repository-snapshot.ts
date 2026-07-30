import type {
  GitConflictOperation,
  GitPushTarget,
  GitStatusEntry,
  GitUpstreamStatus
} from './types'

export type GitRepositorySnapshotRequest = {
  worktreePath: string
  connectionId?: string
  includeIgnored?: boolean
  bypassEffectiveUpstreamNegativeCache?: boolean
  reuseLineStats?: boolean
  pushTarget?: GitPushTarget
}

export type GitRepositoryProjectionFreshness = Readonly<{
  state: 'missing' | 'fresh' | 'stale' | 'failed' | 'placeholder'
  generation: number
  currentGeneration: number
  revision: number | null
  identity: string | null
}>

export type GitRepositorySnapshotRevisionEvent = Readonly<{
  state: 'invalidated' | 'ready'
  generation: number
  revision: number
}>

export type GitRepositorySnapshotSubscriptionEvent = GitRepositorySnapshotRevisionEvent &
  Readonly<{ incarnation: number }>

export type GitRepositorySnapshot = Readonly<{
  revision: number
  generatedAt: number
  repositoryIdentity: Readonly<{ head: string | null; branch: string | null }>
  status: Readonly<{
    entries: readonly Readonly<GitStatusEntry>[]
    didHitLimit: boolean
    statusLength: number | null
    ignoredPaths: readonly string[]
    lineStatsState: 'missing' | 'complete' | 'skipped-at-limit'
    retentionTruncated: boolean
  }>
  upstream: Readonly<GitUpstreamStatus> | null
  conflicts: GitConflictOperation | null
  worktreeGraphVersion: number
  freshness: Readonly<{
    repositoryIdentity: GitRepositoryProjectionFreshness
    status: GitRepositoryProjectionFreshness
    upstream: GitRepositoryProjectionFreshness
    conflicts: GitRepositoryProjectionFreshness
    worktreeGraph: GitRepositoryProjectionFreshness
  }>
}>
