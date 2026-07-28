import { randomUUID } from 'node:crypto'
import type { PtySourceDeliveryIdentity } from '../shared/pty-source-credit-contract'
import type {
  PtySourceRecoveryRequest,
  PtySourceRecoveryResult
} from '../shared/pty-source-recovery-contract'
import {
  onceSinkSettlement,
  RelayPtySourceSendScheduler,
  type RelayPtySourceDeliveryRecord,
  type RelayPtySourcePublicationCounters
} from './relay-pty-source-send-scheduler'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import type { RelayPtySourceOutput } from './relay-pty-source-output'
import type { SshPtyConsumerSessionAdapter } from './ssh-pty-consumer-session-adapter'

export class RelayPtySourcePublication {
  private readonly deliveries = new Map<string, RelayPtySourceDeliveryRecord>()
  private readonly counters: RelayPtySourcePublicationCounters = {
    opened: 0,
    rotated: 0,
    appendDenied: 0,
    sendCommitted: 0,
    sendRolledBack: 0,
    exitCommitted: 0,
    exitRolledBack: 0
  }

  constructor(
    private readonly dispatcher: RelayDispatcher,
    private readonly session: SshPtyConsumerSessionAdapter,
    private readonly onCapacity: (id: string) => void
  ) {
    this.sender = new RelayPtySourceSendScheduler(
      dispatcher,
      session,
      this.deliveries,
      this.counters,
      onCapacity
    )
  }

  private readonly sender: RelayPtySourceSendScheduler

  activate(
    id: string,
    ptyIncarnation: string,
    context: RequestContext | undefined,
    recovery?: PtySourceRecoveryRequest
  ): false | 'opened' | 'rotated' | 'existing' | PtySourceRecoveryResult {
    if (!context?.onResponseSettled) {
      this.sender.releaseRotationFence(this.deliveries.get(id))
      return false
    }
    const mode = this.session.deliveryMode(context.clientId)
    const current = this.deliveries.get(id)
    if (mode === 'subscriber') {
      this.sender.releaseRotationFence(current)
      return false
    }
    if (mode === 'legacy-owner') {
      if (current) {
        this.session.cancelDelivery(current.identity, 'source-credit-disabled')
        this.deliveries.delete(id)
        this.onCapacity(id)
      }
      return false
    }
    if (current?.clientId === context.clientId) {
      this.sender.releaseRotationFence(current)
      return 'existing'
    }
    let identity: PtySourceDeliveryIdentity | null = null
    let displayEnd = 0
    let recoveryCheckpointSourceEndSu: number | null = null
    let recoveryEndSu: number | null = null
    if (!current && recovery) {
      return this.publishRestoreRequired(id, context, 'deliveryUnavailable')
    }
    if (current) {
      try {
        const snapshot = this.session.sourceDeliverySnapshot(current.identity)
        if (
          snapshot.state === 'closed' ||
          snapshot.state === 'closing' ||
          recovery?.status !== 'checkpoint' ||
          recovery.deliveryToken !== current.identity.deliveryToken ||
          recovery.clientGeneration !== current.identity.clientGeneration ||
          recovery.ownerGeneration !== current.identity.ownerGeneration ||
          recovery.ptyIncarnation !== current.identity.ptyIncarnation
        ) {
          return this.requireRestore(id, current, context, 'checkpointUnavailable')
        }
        const rotation = this.session.rotateDelivery(
          current.identity,
          context.clientId,
          recovery.acceptedSourceEndSu
        )
        identity = rotation.identity
        displayEnd = current.displayEnd
        recoveryCheckpointSourceEndSu = recovery.acceptedSourceEndSu
        recoveryEndSu = snapshot.receivedEndSu
        this.counters.rotated++
      } catch (error) {
        return this.requireRestore(
          id,
          current,
          context,
          error instanceof Error ? error.message : 'invalidCheckpoint'
        )
      }
    }
    identity ??= this.session.openDelivery(context.clientId, id, ptyIncarnation)
    if (!identity) {
      return false
    }
    if (!current || identity !== current.identity) {
      this.counters.opened++
    }
    const record: RelayPtySourceDeliveryRecord = {
      clientId: context.clientId,
      identity,
      displayEnd,
      activating: true,
      sealed: false,
      legacyExitAccepted: false,
      sourceExitAccepted: false,
      sending: false,
      turnFrames: 0,
      turnSourceSu: 0,
      turnScheduled: false,
      sendWaiters: new Set(),
      recoveryCheckpointSourceEndSu,
      recoveryEndSu,
      restoreRequired: false,
      rotationPending: false
    }
    this.deliveries.set(id, record)
    context.onResponseSettled((result) => {
      if (this.deliveries.get(id) !== record) {
        return
      }
      if (!result.ok) {
        this.session.cancelDelivery(record.identity, 'activation-publication-failed')
        this.deliveries.delete(id)
        return
      }
      record.activating = false
      this.sender.completeRecoveryIfReady(record)
      this.sender.pump(record)
      this.onCapacity(id)
    })
    if (recoveryEndSu !== null && recoveryCheckpointSourceEndSu !== null) {
      return Object.freeze({
        status: 'pending',
        clientGeneration: identity.clientGeneration,
        ownerGeneration: identity.ownerGeneration,
        ptyIncarnation: identity.ptyIncarnation,
        deliveryToken: identity.deliveryToken,
        checkpointSourceEndSu: recoveryCheckpointSourceEndSu,
        recoveryEndSu
      })
    }
    return current ? 'rotated' : 'opened'
  }

  accepts = (id: string): boolean => this.deliveries.has(id)

  waitForPendingSend = (id: string, timeoutMs = 5_000): Promise<boolean> =>
    this.sender.waitForPendingSend(id, timeoutMs)

  publish(id: string, output: RelayPtySourceOutput, interactive: boolean): boolean {
    const record = this.deliveries.get(id)
    if (!record || record.sealed || record.restoreRequired || record.rotationPending) {
      return false
    }
    if (!output.sourceAccepted) {
      const rawLength = output.rawLength ?? output.data.length
      output.sourceSpanId ??= randomUUID()
      try {
        this.session.appendSource(record.identity, {
          spanId: output.sourceSpanId,
          data: output.data,
          displayStart: record.displayEnd,
          displayEnd: record.displayEnd + output.data.length,
          splittable: output.transformed !== true,
          transform: {
            transformed: output.transformed === true,
            rawLengthSu: rawLength,
            scalarSafe: output.transformed !== true
          }
        })
      } catch {
        this.counters.appendDenied++
        return false
      }
      output.sourceAccepted = true
      record.displayEnd += output.data.length
    }
    if (
      !this.dispatcher.tryNotifyPtyDataToMatchingClients(
        (clientId) => this.session.deliveryMode(clientId) !== 'source-owner',
        {
          id,
          data: output.data,
          ...(output.seq === undefined ? {} : { seq: output.seq }),
          ...(output.rawLength === undefined ? {} : { rawLength: output.rawLength }),
          ...(output.transformed ? { transformed: true } : {})
        },
        { interactive }
      )
    ) {
      return false
    }
    this.sender.pump(record)
    return true
  }

  sealAndPublishExit(params: { id: string; code: number; incarnationId: string }): boolean {
    const record = this.deliveries.get(params.id)
    if (!record) {
      return false
    }
    if (record.restoreRequired) {
      const published = this.dispatcher.tryNotifyPtyExit(params)
      if (published && this.deliveries.get(params.id) === record) {
        this.deliveries.delete(params.id)
      }
      return published
    }
    if (!record.sealed) {
      this.session.sealDelivery(record.identity)
      record.sealed = true
    }
    this.sender.pump(record)
    const snapshot = this.session.sourceDeliverySnapshot(record.identity)
    if (snapshot.sentEndSu !== snapshot.receivedEndSu) {
      return false
    }
    if (!record.legacyExitAccepted) {
      record.legacyExitAccepted = this.dispatcher.tryNotifyPtyExitToMatchingClients(
        (clientId) => this.session.deliveryMode(clientId) !== 'source-owner',
        params
      )
      if (!record.legacyExitAccepted) {
        return false
      }
    }
    if (record.sourceExitAccepted) {
      return true
    }
    const settle = onceSinkSettlement((result) => {
      try {
        this.session.settleExitPublication(record.identity, result)
        if (result.ok) {
          this.counters.exitCommitted++
        } else {
          this.counters.exitRolledBack++
        }
        this.sender.pruneClosed(params.id, record)
      } finally {
        this.onCapacity(params.id)
      }
    })
    record.sourceExitAccepted = this.dispatcher.tryNotifyPtyExitToClient(
      record.clientId,
      params,
      settle
    )
    return record.sourceExitAccepted
  }

  onCreditAvailable = (id: string): void => this.sender.onCreditAvailable(id)

  getDebugSnapshot = () => this.sender.getDebugSnapshot()

  dispose = (): void => this.sender.dispose()

  private requireRestore(
    id: string,
    current: RelayPtySourceDeliveryRecord,
    context: RequestContext,
    reason: string
  ): Readonly<{ status: 'restoreRequired'; reason: string }> {
    this.session.cancelDelivery(current.identity, `recovery-${reason}`)
    current.restoreRequired = true
    current.activating = false
    this.sender.wakeSendWaiters(current)
    current.recoveryCheckpointSourceEndSu = null
    current.recoveryEndSu = null
    return this.publishRestoreRequired(id, context, reason)
  }

  private publishRestoreRequired(
    id: string,
    context: RequestContext,
    reason: string
  ): Readonly<{ status: 'restoreRequired'; reason: string }> {
    const result = Object.freeze({ status: 'restoreRequired' as const, reason })
    context.onResponseSettled?.((settlement) => {
      if (settlement.ok) {
        this.dispatcher.notifyClient(context.clientId, 'pty.restoreRequired', { id, reason })
      }
    })
    this.onCapacity(id)
    return result
  }
}
