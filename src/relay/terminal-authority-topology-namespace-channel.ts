import { randomUUID } from 'node:crypto'
import type { TerminalAuthorityObserverAccess } from '../main/session-authority/terminal-session-authority-access'
import type { TerminalAuthorityNamespace } from '../shared/terminal-session-authority-identity'
import type { TerminalAuthorityProjection } from '../shared/terminal-session-authority-mutation'
import {
  TERMINAL_AUTHORITY_TOPOLOGY_CHANGED_NOTIFICATION,
  type TerminalAuthorityTopologyChange,
  type TerminalAuthorityTopologyPaneChange,
  type TerminalAuthorityTopologySnapshot
} from '../shared/terminal-authority-topology-stream-contract'
import {
  parseTerminalAuthorityTopologyChange,
  parseTerminalAuthorityTopologySnapshot
} from '../shared/terminal-authority-topology-stream-validation'
import type { TerminalLegacyRecoveryNoticeProjection } from '../shared/terminal-legacy-cutover'
import type {
  TerminalAuthorityTopologyChannelService,
  TerminalAuthorityTopologyChannelSubscription,
  TerminalAuthorityTopologyChannelTransport,
  TerminalAuthorityTopologyRecoverySource
} from './terminal-authority-topology-channel-contract'
import {
  createTerminalAuthorityTopologyChangePlan,
  terminalAuthorityTopologyGapSignalBatch,
  type TerminalAuthorityTopologyChangeBatch
} from './terminal-authority-topology-change-plan'
import { groupAtomicTerminalAuthorityTopologyPaneChanges } from './terminal-authority-topology-pane-diff'

export type {
  TerminalAuthorityTopologyChannelService,
  TerminalAuthorityTopologyChannelSubscription,
  TerminalAuthorityTopologyChannelTransport,
  TerminalAuthorityTopologyRecoverySource
} from './terminal-authority-topology-channel-contract'

type Subscription = {
  clientId: number
  subscriptionId: string
  disposed: boolean
}

export class TerminalAuthorityTopologyNamespaceChannel {
  private readonly subscriptions = new Set<Subscription>()
  private readonly observer: TerminalAuthorityObserverAccess
  private streamIncarnationId: string
  private projection: TerminalAuthorityProjection | null = null
  private recoveryNotices: TerminalLegacyRecoveryNoticeProjection | null = null
  private operationQueue: Promise<void> = Promise.resolve()
  private pendingProjection: TerminalAuthorityProjection | null = null
  private drainQueued = false
  private changeSequence = 0
  private disposed = false

  constructor(
    private readonly service: TerminalAuthorityTopologyChannelService,
    private readonly recoverySource: TerminalAuthorityTopologyRecoverySource,
    private readonly transport: TerminalAuthorityTopologyChannelTransport,
    private readonly onEmpty: (channel: TerminalAuthorityTopologyNamespaceChannel) => void,
    private readonly onFailure: (error: Error) => void,
    private readonly createId: () => string = randomUUID
  ) {
    this.streamIncarnationId = createId()
    this.observer = service.subscribeProjection(
      `terminal-authority-topology:${this.streamIncarnationId}`,
      (change) => this.acceptProjection(change.projection)
    )
  }

  get namespace(): TerminalAuthorityNamespace {
    return this.service.namespace
  }

  get subscriptionCount(): number {
    return this.subscriptions.size
  }

  subscribe(
    clientId: number,
    subscriptionId: string
  ): TerminalAuthorityTopologyChannelSubscription {
    this.assertActive()
    const subscription: Subscription = { clientId, subscriptionId, disposed: false }
    this.subscriptions.add(subscription)
    return Object.freeze({ dispose: () => this.removeSubscription(subscription) })
  }

  captureSnapshot(subscriptionId: string): Promise<TerminalAuthorityTopologySnapshot> {
    return this.enqueue(() => {
      const projection = this.service.snapshotForObserver(this.observer)
      this.pendingProjection = null
      this.applyProjection(projection)
      const current = this.projection
      const recoveryNotices = this.recoveryNotices
      if (!current || !recoveryNotices) {
        throw new Error('terminal_authority_topology_snapshot_unavailable')
      }
      return parseTerminalAuthorityTopologySnapshot({
        protocolVersion: 1,
        subscriptionId,
        streamIncarnationId: this.streamIncarnationId,
        namespace: current.namespace,
        writerEpoch: current.writerEpoch,
        authorityRevision: current.revision,
        appliedChangeSequence: this.changeSequence,
        panes: current.panes,
        namespaceRecoveryNotices: recoveryNotices
      })
    })
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.pendingProjection = null
    this.subscriptions.clear()
    try {
      this.service.revokeObserver(this.observer)
    } catch (error) {
      this.onFailure(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private acceptProjection(projection: TerminalAuthorityProjection): void {
    if (this.disposed) {
      return
    }
    this.pendingProjection = projection
    if (this.drainQueued) {
      return
    }
    this.drainQueued = true
    void this.enqueue(() => {
      this.drainQueued = false
      const pending = this.pendingProjection
      this.pendingProjection = null
      if (pending) {
        this.applyProjection(pending)
      }
    }).catch((error) => this.disconnectAll(error))
  }

  private applyProjection(next: TerminalAuthorityProjection): void {
    const nextRecovery = this.recoverySource.recoveryNoticesForNamespace(next.namespace)
    const current = this.projection
    if (!current) {
      this.projection = next
      this.recoveryNotices = nextRecovery
      return
    }
    if (next.writerEpoch !== current.writerEpoch) {
      this.streamIncarnationId = this.createId()
      this.changeSequence = 0
      this.projection = next
      this.recoveryNotices = nextRecovery
      this.disconnectAll(new Error('terminal_authority_topology_writer_epoch_changed'))
      return
    }
    if (next.revision < current.revision) {
      this.disconnectAll(new Error('terminal_authority_topology_projection_regressed'))
      return
    }
    const recoveryChanged =
      !this.recoveryNotices || JSON.stringify(this.recoveryNotices) !== JSON.stringify(nextRecovery)
    const groups = groupAtomicTerminalAuthorityTopologyPaneChanges(current.panes, next.panes)
    if (groups.length === 0 && !recoveryChanged) {
      this.projection = next
      return
    }
    const plannedSequenceCeiling = this.changeSequence + groups.length + 1
    const batchFits = this.batchFits.bind(this, current, next, plannedSequenceCeiling)
    const batches = createTerminalAuthorityTopologyChangePlan(
      groups,
      recoveryChanged ? nextRecovery : null,
      batchFits
    )
    if (!batches) {
      this.projection = next
      this.recoveryNotices = nextRecovery
      this.disconnectAll(new Error('terminal_authority_topology_change_capacity'))
      return
    }
    this.projection = next
    this.recoveryNotices = nextRecovery
    if (batches.length > 1) {
      this.changeSequence += batches.length
      this.publishBatch(current, next, 0, terminalAuthorityTopologyGapSignalBatch(batches))
      return
    }
    this.changeSequence += 1
    this.publishBatch(current, next, 0, batches[0])
  }

  private batchFits(
    current: TerminalAuthorityProjection,
    next: TerminalAuthorityProjection,
    changeSequence: number,
    batchIndex: number,
    paneChanges: readonly TerminalAuthorityTopologyPaneChange[],
    recoveryNotices?: TerminalLegacyRecoveryNoticeProjection
  ): boolean {
    try {
      for (const subscription of this.publicationSubscriptions()) {
        this.buildChange(
          subscription,
          current,
          next,
          batchIndex,
          changeSequence,
          paneChanges,
          recoveryNotices
        )
      }
      return this.subscriptions.size > 0
    } catch {
      return false
    }
  }

  private publishBatch(
    current: TerminalAuthorityProjection,
    next: TerminalAuthorityProjection,
    batchIndex: number,
    batch: TerminalAuthorityTopologyChangeBatch
  ): void {
    for (const subscription of this.publicationSubscriptions()) {
      const change = this.buildChange(
        subscription,
        current,
        next,
        batchIndex,
        this.changeSequence,
        batch.paneChanges,
        batch.recoveryNotices
      )
      if (
        !this.transport.notify(
          subscription.clientId,
          TERMINAL_AUTHORITY_TOPOLOGY_CHANGED_NOTIFICATION,
          change
        )
      ) {
        this.transport.disconnect(
          subscription.clientId,
          new Error('terminal_authority_topology_notification_rejected')
        )
      }
    }
  }

  private buildChange(
    subscription: Subscription,
    current: TerminalAuthorityProjection,
    next: TerminalAuthorityProjection,
    batchIndex: number,
    changeSequence: number,
    paneChanges: readonly TerminalAuthorityTopologyPaneChange[],
    recoveryNotices?: TerminalLegacyRecoveryNoticeProjection
  ): TerminalAuthorityTopologyChange {
    return parseTerminalAuthorityTopologyChange({
      protocolVersion: 1,
      subscriptionId: subscription.subscriptionId,
      streamIncarnationId: this.streamIncarnationId,
      namespace: next.namespace,
      writerEpoch: next.writerEpoch,
      baseAuthorityRevision: batchIndex === 0 ? current.revision : next.revision,
      authorityRevision: next.revision,
      changeSequence,
      paneChanges,
      ...(recoveryNotices ? { namespaceRecoveryNotices: recoveryNotices } : {})
    })
  }

  private disconnectAll(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error))
    const clients = new Set([...this.subscriptions].map(({ clientId }) => clientId))
    for (const clientId of clients) {
      this.transport.disconnect(clientId, normalized)
    }
  }

  private publicationSubscriptions(): readonly Subscription[] {
    const unique = new Map<string, Subscription>()
    for (const subscription of this.subscriptions) {
      unique.set(JSON.stringify([subscription.clientId, subscription.subscriptionId]), subscription)
    }
    return [...unique.values()]
  }

  private removeSubscription(subscription: Subscription): void {
    if (subscription.disposed) {
      return
    }
    subscription.disposed = true
    this.subscriptions.delete(subscription)
    if (this.subscriptions.size === 0) {
      this.onEmpty(this)
    }
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    this.assertActive()
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('terminal_authority_topology_channel_disposed')
    }
  }
}
