import type { GitPushTarget, GitStatusResult, GitUpstreamStatus } from '../../shared/types'
import { InFlightPromiseDedupe, stableInFlightKey } from '../../shared/in-flight-promise-dedupe'
import { GitStatusReadLeaseOwner } from './git-status-read-lease-owner'
import {
  createGitRepositoryProjectionFreshness,
  EMPTY_GIT_IGNORED_PATHS,
  EMPTY_GIT_STATUS_ENTRIES,
  freezeGitRepositoryStatus,
  freezeGitRepositoryUpstream,
  gitRepositoryScopeKey,
  gitRepositoryStatusKey,
  gitRepositoryUpstreamKey,
  type GitRepositoryExecutionIdentity,
  type GitRepositorySnapshot,
  type GitRepositorySnapshotQuery,
  type GitRepositoryStatusIdentity,
  type GitRepositoryStatusProjection
} from './git-repository-snapshot-projection'

export type {
  GitRepositoryExecutionIdentity,
  GitRepositoryProjectionFreshness,
  GitRepositorySnapshot,
  GitRepositorySnapshotQuery,
  GitRepositoryStatusIdentity
} from './git-repository-snapshot-projection'

export const MAX_GIT_REPOSITORY_SNAPSHOTS = 64
export const MAX_GIT_REPOSITORY_PROJECTION_VARIANTS = 4

type ProjectionRecord<T> = {
  generation: number
  generatedAt: number
  revision: number
  value: T
  failedGeneration?: number
}

type RepositoryRecord = {
  status: Map<string, ProjectionRecord<GitRepositoryStatusProjection>>
  upstream: Map<string, ProjectionRecord<Readonly<GitUpstreamStatus>>>
}

function clampBound(value: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(1, Math.floor(value))) : maximum
}

export class GitRepositorySnapshotOwner {
  private readonly statusReads = new GitStatusReadLeaseOwner<GitStatusResult>()
  private readonly upstreamReads = new InFlightPromiseDedupe<GitUpstreamStatus>()
  private readonly repositories = new Map<string, RepositoryRecord>()
  private readonly maxRepositories: number
  private readonly maxProjectionVariants: number
  private generation = 0
  private revision = 0

  constructor(
    maxRepositories = MAX_GIT_REPOSITORY_SNAPSHOTS,
    maxProjectionVariants = MAX_GIT_REPOSITORY_PROJECTION_VARIANTS,
    private readonly now: () => number = Date.now
  ) {
    this.maxRepositories = clampBound(maxRepositories, MAX_GIT_REPOSITORY_SNAPSHOTS)
    this.maxProjectionVariants = clampBound(
      maxProjectionVariants,
      MAX_GIT_REPOSITORY_PROJECTION_VARIANTS
    )
  }

  readStatus(
    executionIdentity: GitRepositoryExecutionIdentity,
    worktreePath: string,
    identity: GitRepositoryStatusIdentity,
    signal: AbortSignal | undefined,
    load: (sharedSignal: AbortSignal) => Promise<GitStatusResult>
  ): Promise<GitStatusResult> {
    const repositoryKey = gitRepositoryScopeKey(executionIdentity, worktreePath)
    const projectionKey = gitRepositoryStatusKey(identity)
    const generation = this.generation
    return this.statusReads.lease(
      stableInFlightKey([repositoryKey, projectionKey]),
      signal,
      async (sharedSignal) => {
        const repository = this.getOrCreateRepository(repositoryKey)
        try {
          const result = await load(sharedSignal)
          this.publishStatus(repositoryKey, repository, projectionKey, generation, result)
          return result
        } catch (error) {
          const retained = repository.status.get(projectionKey)
          if (
            !sharedSignal.aborted &&
            generation === this.generation &&
            this.repositories.get(repositoryKey) === repository &&
            retained
          ) {
            retained.failedGeneration = generation
          }
          this.removeEmptyRepository(repositoryKey, repository)
          throw error
        }
      }
    )
  }

  readUpstream(
    executionIdentity: GitRepositoryExecutionIdentity,
    worktreePath: string,
    pushTarget: GitPushTarget | undefined,
    load: () => Promise<GitUpstreamStatus>
  ): Promise<GitUpstreamStatus> {
    const repositoryKey = gitRepositoryScopeKey(executionIdentity, worktreePath)
    const projectionKey = gitRepositoryUpstreamKey(pushTarget)
    const generation = this.generation
    return this.upstreamReads.run(stableInFlightKey([repositoryKey, projectionKey]), async () => {
      const repository = this.getOrCreateRepository(repositoryKey)
      try {
        const result = await load()
        this.publishUpstream(repositoryKey, repository, projectionKey, generation, result)
        return result
      } catch (error) {
        const retained = repository.upstream.get(projectionKey)
        if (
          generation === this.generation &&
          this.repositories.get(repositoryKey) === repository &&
          retained
        ) {
          retained.failedGeneration = generation
        }
        this.removeEmptyRepository(repositoryKey, repository)
        throw error
      }
    })
  }

  getSnapshot(query: GitRepositorySnapshotQuery): GitRepositorySnapshot | null {
    const repositoryKey = gitRepositoryScopeKey(query.executionIdentity, query.worktreePath)
    const repository = this.repositories.get(repositoryKey)
    if (!repository) {
      return null
    }
    this.touchRepository(repositoryKey, repository)
    const statusIdentity = gitRepositoryStatusKey(query.statusIdentity)
    const upstreamIdentity = gitRepositoryUpstreamKey(query.pushTarget)
    const statusRecord = repository.status.get(statusIdentity)
    const upstreamRecord = repository.upstream.get(upstreamIdentity)
    if (!statusRecord && !upstreamRecord) {
      return null
    }

    const statusFreshness = createGitRepositoryProjectionFreshness(
      statusRecord,
      this.generation,
      statusIdentity
    )
    const embeddedUpstreamRecord =
      query.pushTarget === undefined && statusRecord?.value.upstream ? statusRecord : undefined
    const useEmbeddedUpstream =
      embeddedUpstreamRecord &&
      (!upstreamRecord || embeddedUpstreamRecord.revision > upstreamRecord.revision)
    const selectedUpstreamRecord = useEmbeddedUpstream ? embeddedUpstreamRecord : upstreamRecord
    const upstreamFreshness = selectedUpstreamRecord
      ? createGitRepositoryProjectionFreshness(
          selectedUpstreamRecord,
          this.generation,
          useEmbeddedUpstream ? `status:${statusIdentity}` : upstreamIdentity
        )
      : createGitRepositoryProjectionFreshness(undefined, this.generation, upstreamIdentity)
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
          generation: this.generation,
          currentGeneration: this.generation,
          revision: null,
          identity: null
        })
      })
    })
  }

  invalidate(): void {
    this.generation += 1
    this.statusReads.invalidate()
    this.upstreamReads.clear()
  }

  getRetentionState(): Readonly<{
    repositories: number
    statusProjections: number
    upstreamProjections: number
  }> {
    let statusProjections = 0
    let upstreamProjections = 0
    for (const repository of this.repositories.values()) {
      statusProjections += repository.status.size
      upstreamProjections += repository.upstream.size
    }
    return Object.freeze({
      repositories: this.repositories.size,
      statusProjections,
      upstreamProjections
    })
  }

  private getOrCreateRepository(repositoryKey: string): RepositoryRecord {
    const existing = this.repositories.get(repositoryKey)
    if (existing) {
      this.touchRepository(repositoryKey, existing)
      return existing
    }
    const repository = { status: new Map(), upstream: new Map() }
    this.repositories.set(repositoryKey, repository)
    while (this.repositories.size > this.maxRepositories) {
      const oldestKey = this.repositories.keys().next().value
      if (oldestKey === undefined) {
        break
      }
      this.repositories.delete(oldestKey)
    }
    return repository
  }

  private touchRepository(repositoryKey: string, repository: RepositoryRecord): void {
    this.repositories.delete(repositoryKey)
    this.repositories.set(repositoryKey, repository)
  }

  private removeEmptyRepository(repositoryKey: string, repository: RepositoryRecord): void {
    if (
      this.repositories.get(repositoryKey) === repository &&
      repository.status.size === 0 &&
      repository.upstream.size === 0
    ) {
      this.repositories.delete(repositoryKey)
    }
  }

  private publishStatus(
    repositoryKey: string,
    repository: RepositoryRecord,
    projectionKey: string,
    generation: number,
    result: GitStatusResult
  ): void {
    if (generation !== this.generation || this.repositories.get(repositoryKey) !== repository) {
      return
    }
    const revision = this.nextRevision()
    const generatedAt = this.now()
    this.remember(repository.status, projectionKey, {
      generation,
      generatedAt,
      revision,
      value: freezeGitRepositoryStatus(result)
    })
  }

  private publishUpstream(
    repositoryKey: string,
    repository: RepositoryRecord,
    projectionKey: string,
    generation: number,
    result: GitUpstreamStatus
  ): void {
    if (generation !== this.generation || this.repositories.get(repositoryKey) !== repository) {
      return
    }
    this.remember(repository.upstream, projectionKey, {
      generation,
      generatedAt: this.now(),
      revision: this.nextRevision(),
      value: freezeGitRepositoryUpstream(result)
    })
  }

  private remember<T>(projections: Map<string, T>, key: string, value: T): void {
    projections.delete(key)
    projections.set(key, value)
    while (projections.size > this.maxProjectionVariants) {
      const oldestKey = projections.keys().next().value
      if (oldestKey === undefined) {
        break
      }
      projections.delete(oldestKey)
    }
  }

  private nextRevision(): number {
    this.revision += 1
    return this.revision
  }
}

export const nativeAndWslGitRepositorySnapshotOwner = new GitRepositorySnapshotOwner()
