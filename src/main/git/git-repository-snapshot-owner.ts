import type { GitPushTarget, GitStatusResult, GitUpstreamStatus } from '../../shared/types'
import type { GitRepositorySnapshotRevisionEvent } from '../../shared/git-repository-snapshot'
import { InFlightPromiseDedupe, stableInFlightKey } from '../../shared/in-flight-promise-dedupe'
import { GitStatusReadLeaseOwner } from './git-status-read-lease-owner'
import {
  freezeGitRepositoryStatus,
  freezeGitRepositoryUpstream,
  gitRepositoryScopeKey,
  gitRepositoryStatusKey,
  gitRepositoryUpstreamKey,
  type GitRepositoryExecutionIdentity,
  type GitRepositorySnapshot,
  type GitRepositorySnapshotQuery,
  type GitRepositoryStatusIdentity
} from './git-repository-snapshot-projection'
import {
  GitRepositorySnapshotRevisionSubscriptions,
  type GitRepositoryRecord
} from './git-repository-snapshot-revision-subscriptions'
import { createGitRepositorySnapshot } from './git-repository-snapshot-reader'

export type {
  GitRepositoryExecutionIdentity,
  GitRepositoryProjectionFreshness,
  GitRepositorySnapshot,
  GitRepositorySnapshotQuery,
  GitRepositoryStatusIdentity
} from './git-repository-snapshot-projection'

export const MAX_GIT_REPOSITORY_SNAPSHOTS = 64
export const MAX_GIT_REPOSITORY_PROJECTION_VARIANTS = 4

function clampBound(value: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(1, Math.floor(value))) : maximum
}

export class GitRepositorySnapshotOwner {
  private readonly statusReads = new GitStatusReadLeaseOwner<GitStatusResult>()
  private readonly upstreamReads = new InFlightPromiseDedupe<GitUpstreamStatus>()
  private readonly repositories = new Map<string, GitRepositoryRecord>()
  private readonly revisionSubscriptions = new GitRepositorySnapshotRevisionSubscriptions()
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
    return createGitRepositorySnapshot(
      repository,
      this.generation,
      statusIdentity,
      upstreamIdentity,
      query.pushTarget === undefined
    )
  }

  subscribe(
    query: GitRepositorySnapshotQuery,
    listener: (event: GitRepositorySnapshotRevisionEvent) => void
  ): () => void {
    return this.revisionSubscriptions.subscribe(query, listener)
  }

  invalidate(): void {
    this.generation += 1
    this.statusReads.invalidate()
    this.upstreamReads.clear()
    this.revisionSubscriptions.invalidate(this.generation, this.revision)
  }

  getSubscriptionCountForTests(): number {
    return this.revisionSubscriptions.count
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

  private getOrCreateRepository(repositoryKey: string): GitRepositoryRecord {
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

  private touchRepository(repositoryKey: string, repository: GitRepositoryRecord): void {
    this.repositories.delete(repositoryKey)
    this.repositories.set(repositoryKey, repository)
  }

  private removeEmptyRepository(repositoryKey: string, repository: GitRepositoryRecord): void {
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
    repository: GitRepositoryRecord,
    projectionKey: string,
    generation: number,
    result: GitStatusResult
  ): void {
    if (generation !== this.generation || this.repositories.get(repositoryKey) !== repository) {
      return
    }
    const previous = repository.status.get(projectionKey)
    const revision = this.nextRevision()
    const generatedAt = this.now()
    this.remember(repository.status, projectionKey, {
      generation,
      generatedAt,
      revision,
      value: freezeGitRepositoryStatus(result)
    })
    this.revisionSubscriptions.statusPublished(
      repositoryKey,
      repository,
      projectionKey,
      previous,
      this.generation
    )
  }

  private publishUpstream(
    repositoryKey: string,
    repository: GitRepositoryRecord,
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
    this.revisionSubscriptions.upstreamPublished(
      repositoryKey,
      repository,
      projectionKey,
      this.generation
    )
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
