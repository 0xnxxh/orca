import type { GitConflictOperation, GitStatusEntry, GitUpstreamStatus } from './types'

export type GitRepositoryProjectionFreshness = Readonly<{
  state: 'missing' | 'fresh' | 'stale' | 'failed' | 'placeholder'
  generation: number
  currentGeneration: number
  revision: number | null
  identity: string | null
}>

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
