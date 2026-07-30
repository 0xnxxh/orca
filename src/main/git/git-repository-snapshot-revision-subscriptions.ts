import type { GitRepositorySnapshotRevisionEvent } from '../../shared/git-repository-snapshot'
import type { GitUpstreamStatus } from '../../shared/types'
import type { GitRepositoryStatusProjection } from './git-repository-snapshot-projection'
import {
  gitRepositoryScopeKey,
  gitRepositoryStatusKey,
  gitRepositoryUpstreamKey,
  type GitRepositorySnapshotQuery
} from './git-repository-snapshot-projection'

export type GitRepositoryProjectionRecord<T> = {
  generation: number
  generatedAt: number
  revision: number
  value: T
  failedGeneration?: number
}

export type GitRepositoryRecord = {
  status: Map<string, GitRepositoryProjectionRecord<GitRepositoryStatusProjection>>
  upstream: Map<string, GitRepositoryProjectionRecord<Readonly<GitUpstreamStatus>>>
}

type SnapshotSubscription = {
  statusKey: string
  upstreamKey: string
  usesConfiguredUpstream: boolean
  lastReadyRevision: number
  listener: (event: GitRepositorySnapshotRevisionEvent) => void
}

export class GitRepositorySnapshotRevisionSubscriptions {
  private readonly subscriptions = new Map<string, Set<SnapshotSubscription>>()

  subscribe(
    query: GitRepositorySnapshotQuery,
    listener: (event: GitRepositorySnapshotRevisionEvent) => void
  ): () => void {
    const repositoryKey = gitRepositoryScopeKey(query.executionIdentity, query.worktreePath)
    const subscription: SnapshotSubscription = {
      statusKey: gitRepositoryStatusKey(query.statusIdentity),
      upstreamKey: gitRepositoryUpstreamKey(query.pushTarget),
      usesConfiguredUpstream: query.pushTarget === undefined,
      lastReadyRevision: 0,
      listener
    }
    const subscriptions = this.subscriptions.get(repositoryKey) ?? new Set()
    subscriptions.add(subscription)
    this.subscriptions.set(repositoryKey, subscriptions)
    return () => {
      subscriptions.delete(subscription)
      if (subscriptions.size === 0) {
        this.subscriptions.delete(repositoryKey)
      }
    }
  }

  invalidate(generation: number, revision: number): void {
    const event = Object.freeze({ state: 'invalidated' as const, generation, revision })
    for (const subscriptions of this.subscriptions.values()) {
      for (const subscription of subscriptions) {
        subscription.listener(event)
      }
    }
  }

  statusPublished(
    repositoryKey: string,
    repository: GitRepositoryRecord,
    projectionKey: string,
    previous: GitRepositoryProjectionRecord<GitRepositoryStatusProjection> | undefined,
    generation: number
  ): void {
    const subscriptions = this.subscriptions.get(repositoryKey)
    const status = repository.status.get(projectionKey)
    if (!subscriptions || !status || !this.statusRecordIsReady(status, generation)) {
      return
    }
    const events = new Map<number, GitRepositorySnapshotRevisionEvent>()
    for (const subscription of subscriptions) {
      if (subscription.statusKey !== projectionKey) {
        continue
      }
      if (subscription.usesConfiguredUpstream) {
        const embedded = status.value.upstream
        if (embedded) {
          if (this.upstreamValueIsComplete(embedded)) {
            this.emitReady(subscription, generation, status.revision, events)
          }
          continue
        }
      }
      const upstream = repository.upstream.get(subscription.upstreamKey)
      if (
        !this.upstreamRecordIsReady(upstream, generation) ||
        !this.upstreamValueIsComplete(upstream.value) ||
        (upstream.revision <= status.revision &&
          !this.repositoryIdentityMatches(previous?.value, status.value))
      ) {
        continue
      }
      this.emitReady(subscription, generation, Math.max(status.revision, upstream.revision), events)
    }
  }

  upstreamPublished(
    repositoryKey: string,
    repository: GitRepositoryRecord,
    projectionKey: string,
    generation: number
  ): void {
    const subscriptions = this.subscriptions.get(repositoryKey)
    const upstream = repository.upstream.get(projectionKey)
    if (
      !subscriptions ||
      !this.upstreamRecordIsReady(upstream, generation) ||
      !this.upstreamValueIsComplete(upstream.value)
    ) {
      return
    }
    const events = new Map<number, GitRepositorySnapshotRevisionEvent>()
    for (const subscription of subscriptions) {
      if (subscription.upstreamKey !== projectionKey) {
        continue
      }
      const status = repository.status.get(subscription.statusKey)
      if (!status || !this.statusRecordIsReady(status, generation)) {
        continue
      }
      this.emitReady(subscription, generation, Math.max(status.revision, upstream.revision), events)
    }
  }

  get count(): number {
    let count = 0
    for (const subscriptions of this.subscriptions.values()) {
      count += subscriptions.size
    }
    return count
  }

  private statusRecordIsReady(
    record: GitRepositoryProjectionRecord<GitRepositoryStatusProjection>,
    generation: number
  ): boolean {
    return (
      record.generation === generation &&
      record.failedGeneration !== generation &&
      !record.value.status.retentionTruncated
    )
  }

  private upstreamRecordIsReady(
    record: GitRepositoryProjectionRecord<Readonly<GitUpstreamStatus>> | undefined,
    generation: number
  ): record is GitRepositoryProjectionRecord<Readonly<GitUpstreamStatus>> {
    return (
      record !== undefined &&
      record.generation === generation &&
      record.failedGeneration !== generation
    )
  }

  private upstreamValueIsComplete(value: Readonly<GitUpstreamStatus>): boolean {
    return !(
      value.ahead > 0 &&
      value.behind > 0 &&
      value.behindCommitsArePatchEquivalent === undefined
    )
  }

  private repositoryIdentityMatches(
    previous: GitRepositoryStatusProjection | undefined,
    current: GitRepositoryStatusProjection
  ): boolean {
    return (
      previous !== undefined &&
      previous.repositoryIdentity.head === current.repositoryIdentity.head &&
      previous.repositoryIdentity.branch === current.repositoryIdentity.branch
    )
  }

  private emitReady(
    subscription: SnapshotSubscription,
    generation: number,
    revision: number,
    events: Map<number, GitRepositorySnapshotRevisionEvent>
  ): void {
    if (revision <= subscription.lastReadyRevision) {
      return
    }
    subscription.lastReadyRevision = revision
    const event =
      events.get(revision) ?? Object.freeze({ state: 'ready' as const, generation, revision })
    events.set(revision, event)
    subscription.listener(event)
  }
}
