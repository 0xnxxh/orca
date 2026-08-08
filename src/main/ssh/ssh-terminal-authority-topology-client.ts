import {
  TERMINAL_AUTHORITY_TOPOLOGY_CHANGED_NOTIFICATION,
  TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD,
  TERMINAL_AUTHORITY_TOPOLOGY_UNSUBSCRIBE_NOTIFICATION,
  assertTerminalAuthorityTopologyCapabilityGrant,
  type TerminalAuthorityTopologySnapshot,
  type TerminalAuthorityTopologySnapshotRequest
} from '../../shared/terminal-authority-topology-stream-contract'
import {
  parseTerminalAuthorityTopologyChangeWithByteLength,
  parseTerminalAuthorityTopologySnapshot,
  parseTerminalAuthorityTopologySnapshotRequest,
  sameTerminalAuthorityTopologyNamespace
} from '../../shared/terminal-authority-topology-stream-validation'
import {
  SshTerminalAuthorityTopologyReducer,
  type SshTerminalAuthorityTopologyResnapshotReason
} from './ssh-terminal-authority-topology-reducer'
import type {
  SshTerminalAuthorityTopologyClientOptions,
  SshTerminalAuthorityTopologyClientStatus
} from './ssh-terminal-authority-topology-client-contract'
import {
  SshTerminalAuthorityTopologyNotificationBuffer,
  replaySshTerminalAuthorityTopologyNotifications,
  type SshTerminalAuthorityTopologyBufferedNotification
} from './ssh-terminal-authority-topology-notification-buffer'

export const SSH_TERMINAL_AUTHORITY_TOPOLOGY_MAX_REQUESTS_PER_SYNCHRONIZATION = 3

export type {
  SshTerminalAuthorityTopologyClientOptions,
  SshTerminalAuthorityTopologyClientStatus,
  SshTerminalAuthorityTopologyTransport
} from './ssh-terminal-authority-topology-client-contract'

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

export class SshTerminalAuthorityTopologyClient {
  private readonly reducer = new SshTerminalAuthorityTopologyReducer()
  private readonly requestValue: TerminalAuthorityTopologySnapshotRequest
  private statusValue: SshTerminalAuthorityTopologyClientStatus = Object.freeze({ kind: 'idle' })
  private unsubscribeNotification: (() => void) | null = null
  private synchronization: Promise<void> | null = null
  private requestAbortController: AbortController | null = null
  private readonly notificationBuffer = new SshTerminalAuthorityTopologyNotificationBuffer()
  private notificationOrdinal = 0
  private awaitingSnapshot = false
  private started = false
  private disposed = false

  constructor(private readonly options: SshTerminalAuthorityTopologyClientOptions) {
    assertTerminalAuthorityTopologyCapabilityGrant(options.capabilityGrant)
    this.requestValue = parseTerminalAuthorityTopologySnapshotRequest({
      protocolVersion: 1,
      subscriptionId: options.subscriptionId,
      namespace: options.namespace
    })
  }

  get status(): SshTerminalAuthorityTopologyClientStatus {
    return this.statusValue
  }

  authoritativeState(): TerminalAuthorityTopologySnapshot | null {
    return this.statusValue.kind === 'synchronized' ? this.reducer.state() : null
  }

  lastKnownState(): TerminalAuthorityTopologySnapshot | null {
    return this.reducer.state()
  }

  async start(): Promise<TerminalAuthorityTopologySnapshot> {
    if (this.started) {
      throw new Error('terminal_authority_topology_client_already_started')
    }
    if (this.disposed) {
      throw new Error('terminal_authority_topology_client_disposed')
    }
    this.started = true
    this.unsubscribeNotification = this.options.transport.onNotificationByMethod(
      TERMINAL_AUTHORITY_TOPOLOGY_CHANGED_NOTIFICATION,
      (params) => this.handleNotification(params)
    )
    await this.synchronize('initial')
    const state = this.authoritativeState()
    if (!state) {
      throw new Error('terminal_authority_topology_snapshot_unavailable')
    }
    return state
  }

  async resnapshot(): Promise<TerminalAuthorityTopologySnapshot> {
    if (!this.started || this.disposed) {
      throw new Error('terminal_authority_topology_client_not_active')
    }
    await this.synchronize('manual')
    const state = this.authoritativeState()
    if (!state) {
      throw new Error('terminal_authority_topology_snapshot_unavailable')
    }
    return state
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.awaitingSnapshot = false
    this.requestAbortController?.abort()
    this.notificationBuffer.clear()
    if (this.started) {
      this.options.transport.notify(TERMINAL_AUTHORITY_TOPOLOGY_UNSUBSCRIBE_NOTIFICATION, {
        protocolVersion: this.requestValue.protocolVersion,
        subscriptionId: this.requestValue.subscriptionId,
        namespace: this.requestValue.namespace
      })
    }
    this.unsubscribeNotification?.()
    this.unsubscribeNotification = null
    this.publishStatus(Object.freeze({ kind: 'disposed' }))
  }

  private synchronize(
    reason: 'initial' | 'manual' | SshTerminalAuthorityTopologyResnapshotReason
  ): Promise<void> {
    if (this.synchronization) {
      return this.synchronization
    }
    this.publishStatus(Object.freeze({ kind: 'synchronizing', reason }))
    let running: Promise<void>
    running = this.synchronizeUntilExact().finally(() => {
      if (this.synchronization === running) {
        this.synchronization = null
      }
    })
    this.synchronization = running
    return running
  }

  private async synchronizeUntilExact(): Promise<void> {
    try {
      for (
        let request = 0;
        request < SSH_TERMINAL_AUTHORITY_TOPOLOGY_MAX_REQUESTS_PER_SYNCHRONIZATION;
        request += 1
      ) {
        const retryReason = await this.requestExactSnapshot()
        if (!retryReason) {
          if (this.disposed) {
            throw new Error('terminal_authority_topology_client_disposed')
          }
          return
        }
        if (!this.disposed) {
          this.publishStatus(Object.freeze({ kind: 'synchronizing', reason: retryReason }))
        }
      }
      throw new Error('terminal_authority_topology_resnapshot_attempt_capacity')
    } catch (error) {
      const normalized = toError(error)
      if (!this.disposed) {
        this.publishStatus(Object.freeze({ kind: 'stale', error: normalized }))
      }
      throw normalized
    }
  }

  private async requestExactSnapshot(): Promise<SshTerminalAuthorityTopologyResnapshotReason | null> {
    this.notificationBuffer.clear()
    this.awaitingSnapshot = true
    const abortController = new AbortController()
    this.requestAbortController = abortController
    let response: unknown
    try {
      response = await this.options.transport.request(
        TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD,
        {
          protocolVersion: this.requestValue.protocolVersion,
          subscriptionId: this.requestValue.subscriptionId,
          namespace: this.requestValue.namespace
        },
        { signal: abortController.signal }
      )
    } finally {
      if (this.requestAbortController === abortController) {
        this.requestAbortController = null
      }
    }
    if (this.disposed) {
      throw new Error('terminal_authority_topology_client_disposed')
    }
    const snapshot = parseTerminalAuthorityTopologySnapshot(response)
    this.assertExpectedSnapshot(snapshot)
    const snapshotConflict = this.reducer.snapshotConflict(snapshot)
    if (snapshotConflict) {
      return snapshotConflict
    }
    const buffered = this.notificationBuffer.take()
    this.reducer.replace(snapshot)
    const retryReason = replaySshTerminalAuthorityTopologyNotifications({
      reducer: this.reducer,
      snapshot,
      notifications: buffered.notifications,
      overflowOrdinal: buffered.overflowOrdinal
    })
    if (retryReason) {
      return retryReason
    }
    this.awaitingSnapshot = false
    const state = this.reducer.state()!
    this.publishStatus(
      Object.freeze({
        kind: 'synchronized',
        streamIncarnationId: state.streamIncarnationId,
        authorityRevision: state.authorityRevision,
        appliedChangeSequence: state.appliedChangeSequence
      })
    )
    this.options.onAuthoritativeState?.(state)
    return null
  }

  private handleNotification(params: Record<string, unknown>): void {
    if (this.disposed || params.subscriptionId !== this.requestValue.subscriptionId) {
      return
    }
    const ordinal = ++this.notificationOrdinal
    let notification: SshTerminalAuthorityTopologyBufferedNotification
    try {
      const parsed = parseTerminalAuthorityTopologyChangeWithByteLength(params)
      notification = sameTerminalAuthorityTopologyNamespace(
        parsed.value.namespace,
        this.requestValue.namespace
      )
        ? Object.freeze({
            kind: 'change',
            ordinal,
            byteLength: parsed.byteLength,
            change: parsed.value
          })
        : Object.freeze({ kind: 'invalid', ordinal, byteLength: 0 })
    } catch {
      notification = Object.freeze({ kind: 'invalid', ordinal, byteLength: 0 })
    }
    if (this.awaitingSnapshot) {
      this.notificationBuffer.push(notification)
      return
    }
    if (this.statusValue.kind !== 'synchronized' || notification.kind === 'invalid') {
      if (this.statusValue.kind === 'synchronized') {
        this.requestResnapshot('notification-invalid')
      }
      return
    }
    const current = this.reducer.state()
    if (
      current &&
      notification.change.streamIncarnationId !== current.streamIncarnationId &&
      notification.change.writerEpoch < current.writerEpoch
    ) {
      return
    }
    const result = this.reducer.apply(notification.change)
    if (result.kind === 'applied') {
      this.publishStatus(
        Object.freeze({
          kind: 'synchronized',
          streamIncarnationId: result.state.streamIncarnationId,
          authorityRevision: result.state.authorityRevision,
          appliedChangeSequence: result.state.appliedChangeSequence
        })
      )
      this.options.onAuthoritativeState?.(result.state)
    } else if (result.kind === 'resnapshot-required') {
      this.requestResnapshot(result.reason)
    }
  }

  private requestResnapshot(reason: SshTerminalAuthorityTopologyResnapshotReason): void {
    void this.synchronize(reason).catch((error) => {
      try {
        this.options.onSynchronizationError?.(toError(error))
      } catch {
        // A reporting callback cannot restore authority synchronization.
      }
    })
  }

  private assertExpectedSnapshot(snapshot: TerminalAuthorityTopologySnapshot): void {
    if (
      snapshot.subscriptionId !== this.requestValue.subscriptionId ||
      !sameTerminalAuthorityTopologyNamespace(snapshot.namespace, this.requestValue.namespace)
    ) {
      throw new Error('terminal_authority_topology_snapshot_identity_mismatch')
    }
  }

  private publishStatus(status: SshTerminalAuthorityTopologyClientStatus): void {
    this.statusValue = status
    this.options.onStatusChange?.(status)
  }
}
