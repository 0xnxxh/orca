import type { GitRepositorySnapshot } from '../../shared/git-repository-snapshot'
import {
  createGitRepositoryProjectionFreshness,
  EMPTY_GIT_IGNORED_PATHS,
  EMPTY_GIT_STATUS_ENTRIES
} from './git-repository-snapshot-projection'
import type { GitRepositoryRecord } from './git-repository-snapshot-revision-subscriptions'

export function createGitRepositorySnapshot(
  repository: GitRepositoryRecord,
  generation: number,
  statusIdentity: string,
  upstreamIdentity: string,
  usesConfiguredUpstream: boolean
): GitRepositorySnapshot | null {
  const statusRecord = repository.status.get(statusIdentity)
  const upstreamRecord = repository.upstream.get(upstreamIdentity)
  if (!statusRecord && !upstreamRecord) {
    return null
  }

  const statusFreshness = createGitRepositoryProjectionFreshness(
    statusRecord,
    generation,
    statusIdentity
  )
  const embeddedUpstreamRecord =
    usesConfiguredUpstream && statusRecord?.value.upstream ? statusRecord : undefined
  const useEmbeddedUpstream =
    embeddedUpstreamRecord &&
    (!upstreamRecord || embeddedUpstreamRecord.revision > upstreamRecord.revision)
  const selectedUpstreamRecord = useEmbeddedUpstream ? embeddedUpstreamRecord : upstreamRecord
  const upstreamFreshness = selectedUpstreamRecord
    ? createGitRepositoryProjectionFreshness(
        selectedUpstreamRecord,
        generation,
        useEmbeddedUpstream ? `status:${statusIdentity}` : upstreamIdentity
      )
    : createGitRepositoryProjectionFreshness(undefined, generation, upstreamIdentity)
  const revision = Math.max(statusRecord?.revision ?? 0, upstreamRecord?.revision ?? 0)
  const generatedAt = Math.max(statusRecord?.generatedAt ?? 0, upstreamRecord?.generatedAt ?? 0)
  const status = statusRecord?.value
  return Object.freeze({
    revision,
    generatedAt,
    repositoryIdentity: status?.repositoryIdentity ?? Object.freeze({ head: null, branch: null }),
    status:
      status?.status ??
      Object.freeze({
        entries: EMPTY_GIT_STATUS_ENTRIES,
        didHitLimit: false,
        statusLength: null,
        ignoredPaths: EMPTY_GIT_IGNORED_PATHS,
        lineStatsState: 'missing' as const,
        retentionTruncated: false
      }),
    upstream: useEmbeddedUpstream
      ? embeddedUpstreamRecord.value.upstream
      : (upstreamRecord?.value ?? null),
    conflicts: status?.conflicts ?? null,
    worktreeGraphVersion: 0,
    freshness: Object.freeze({
      repositoryIdentity: statusFreshness,
      status: statusFreshness,
      upstream: upstreamFreshness,
      conflicts: statusFreshness,
      worktreeGraph: Object.freeze({
        state: 'placeholder',
        generation,
        currentGeneration: generation,
        revision: null,
        identity: null
      })
    })
  })
}
