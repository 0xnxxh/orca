import type { GitPushTarget, GitUpstreamStatus, GlobalSettings } from '../../../../shared/types'
import type {
  getRuntimeGitRepositorySnapshot,
  RuntimeGitRepositorySnapshotOptions
} from '@/runtime/runtime-git-repository-snapshot-client'
import { readGitRepositorySnapshotUpstream } from '@/runtime/git-repository-snapshot-upstream'

export type SourceControlAutomaticUpstreamContext = {
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  worktreeId: string
  worktreePath: string
  connectionId?: string
  branch: string
  pushTarget?: GitPushTarget
}

type FreshProjection = {
  identity: string
  generation: number
  revision: number
}

type AdmittedSourceControlUpstream = {
  revision: number
  upstream: GitUpstreamStatus
}

type SourceControlAutomaticUpstreamRequest = {
  signal?: AbortSignal
  shouldApply: () => boolean
}

type SourceControlAutomaticUpstreamDependencies = {
  getSnapshot: typeof getRuntimeGitRepositorySnapshot
  fetchFresh: () => Promise<GitUpstreamStatus | null>
  apply: (upstream: GitUpstreamStatus) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readFreshProjection(value: unknown): FreshProjection | null {
  if (
    !isRecord(value) ||
    value.state !== 'fresh' ||
    typeof value.generation !== 'number' ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 0 ||
    value.generation !== value.currentGeneration ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.identity !== 'string' ||
    value.identity.length === 0
  ) {
    return null
  }
  return {
    identity: value.identity,
    generation: value.generation,
    revision: value.revision
  }
}

function canonicalBranch(branch: string | null | undefined): string {
  return (branch ?? '').replace(/^refs\/heads\//, '').trim()
}

export function readSourceControlAutomaticUpstreamSnapshot(
  value: unknown,
  expectedBranch: string
): AdmittedSourceControlUpstream | null {
  if (
    !isRecord(value) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.generatedAt !== 'number' ||
    !Number.isFinite(value.generatedAt) ||
    value.generatedAt < 0 ||
    !isRecord(value.repositoryIdentity) ||
    !isRecord(value.status) ||
    !isRecord(value.freshness) ||
    (value.repositoryIdentity.branch !== null &&
      typeof value.repositoryIdentity.branch !== 'string') ||
    (value.repositoryIdentity.head !== null && typeof value.repositoryIdentity.head !== 'string') ||
    canonicalBranch(value.repositoryIdentity.branch) !== canonicalBranch(expectedBranch) ||
    value.status.retentionTruncated !== false
  ) {
    return null
  }
  const status = readFreshProjection(value.freshness.status)
  const repository = readFreshProjection(value.freshness.repositoryIdentity)
  const upstreamFreshness = readFreshProjection(value.freshness.upstream)
  const upstream = readGitRepositorySnapshotUpstream(value.upstream)
  if (
    !status ||
    !repository ||
    !upstreamFreshness ||
    !upstream ||
    repository.identity !== status.identity ||
    repository.generation !== status.generation ||
    repository.revision !== status.revision ||
    upstreamFreshness.generation !== status.generation
  ) {
    return null
  }
  return { revision: status.revision, upstream }
}

async function readNewestSourceControlUpstream(
  context: SourceControlAutomaticUpstreamContext,
  getSnapshot: typeof getRuntimeGitRepositorySnapshot
): Promise<AdmittedSourceControlUpstream | null> {
  const sharedOptions = context.pushTarget ? { pushTarget: context.pushTarget } : {}
  const options: readonly RuntimeGitRepositorySnapshotOptions[] = [
    sharedOptions,
    { ...sharedOptions, reuseLineStats: true }
  ]
  const results = await Promise.allSettled(
    options.map((identity) => getSnapshot(context, identity))
  )
  let newest: AdmittedSourceControlUpstream | null = null
  for (const result of results) {
    if (result.status !== 'fulfilled') {
      continue
    }
    const admitted = readSourceControlAutomaticUpstreamSnapshot(result.value, context.branch)
    if (admitted && (!newest || admitted.revision > newest.revision)) {
      newest = admitted
    }
  }
  return newest
}

export async function loadSourceControlAutomaticUpstream({
  context,
  request,
  dependencies
}: {
  context: SourceControlAutomaticUpstreamContext
  request: SourceControlAutomaticUpstreamRequest
  dependencies: SourceControlAutomaticUpstreamDependencies
}): Promise<'snapshot' | 'fresh' | 'cancelled'> {
  if (!request.shouldApply() || request.signal?.aborted) {
    return 'cancelled'
  }
  const snapshot = await readNewestSourceControlUpstream(context, dependencies.getSnapshot)
  if (!request.shouldApply() || request.signal?.aborted) {
    return 'cancelled'
  }
  if (snapshot) {
    dependencies.apply(snapshot.upstream)
    return 'snapshot'
  }
  const fresh = await dependencies.fetchFresh()
  if (!fresh || !request.shouldApply() || request.signal?.aborted) {
    return 'cancelled'
  }
  dependencies.apply(fresh)
  return 'fresh'
}
