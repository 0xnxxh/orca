import type { PtySourceDeliveryIdentity, PtySourceSpan } from '../shared/pty-source-credit-contract'
import type { PtySourceReceivingActivation } from '../shared/pty-source-receiving-activation'
import type { RequestContext, SinkWriteSettlement } from './dispatcher'
import type { LegacyPtyProxyExit } from './legacy-pty-proxy'
import { LegacyPhysicalWorkerDownstreamData } from './legacy-physical-worker-downstream-data'
import type {
  LegacyPhysicalWorkerDownstreamAttachment,
  LegacyPhysicalWorkerDownstreamDispatcher,
  LegacyPhysicalWorkerDownstreamOpenInput,
  LegacyPhysicalWorkerDownstreamOpenResult,
  LegacyPhysicalWorkerDownstreamSession
} from './legacy-physical-worker-downstream-contract'
import {
  legacyPhysicalWorkerRecoveryMatches,
  legacyPhysicalWorkerRestoreRequired,
  pendingLegacyPhysicalWorkerRecovery
} from './legacy-physical-worker-downstream-recovery'

export function createLegacyPhysicalWorkerDownstreamAttachment(input: {
  dispatcher: LegacyPhysicalWorkerDownstreamDispatcher
  session: LegacyPhysicalWorkerDownstreamSession
  context: RequestContext
  identity: PtySourceDeliveryIdentity
  checkpointSourceEndSu: number
  recoveryEndSu: number
  onCapacity: () => void
  recoverySpan?: PtySourceSpan
}): LegacyPhysicalWorkerDownstreamAttachment {
  return new DownstreamAttachment(input)
}

class DownstreamAttachment implements LegacyPhysicalWorkerDownstreamAttachment {
  readonly sourceActivation: PtySourceReceivingActivation
  readonly identity: PtySourceDeliveryIdentity
  private readonly data: LegacyPhysicalWorkerDownstreamData
  private readonly removeCapacityListener: () => void
  private exitPending = false
  private pendingExitSettlement: ((result: SinkWriteSettlement) => void) | null = null
  private responseReady = false
  private disposed = false

  constructor(
    private readonly input: {
      dispatcher: LegacyPhysicalWorkerDownstreamDispatcher
      session: LegacyPhysicalWorkerDownstreamSession
      context: RequestContext
      identity: PtySourceDeliveryIdentity
      checkpointSourceEndSu: number
      recoveryEndSu: number
      onCapacity: () => void
      recoverySpan?: PtySourceSpan
    }
  ) {
    this.identity = input.identity
    this.sourceActivation = Object.freeze({
      status: 'pending',
      clientGeneration: input.identity.clientGeneration,
      ownerGeneration: input.identity.ownerGeneration,
      ptyIncarnation: input.identity.ptyIncarnation,
      deliveryToken: input.identity.deliveryToken,
      checkpointSourceEndSu: input.checkpointSourceEndSu,
      recoveryEndSu: input.recoveryEndSu
    })
    this.data = new LegacyPhysicalWorkerDownstreamData(
      input.dispatcher,
      input.session,
      input.context,
      input.identity,
      () => !this.disposed && this.responseReady && !this.exitPending,
      input.onCapacity,
      input.recoverySpan ? { span: input.recoverySpan, endSu: input.recoveryEndSu } : undefined
    )
    this.removeCapacityListener =
      input.dispatcher.onClientCapacity(input.context.clientId, () => {
        this.data.onPublicationCapacity()
        input.onCapacity()
      }) ?? (() => {})
    input.context.onResponseSettled!((settlement) => {
      if (!settlement.ok) {
        this.dispose()
        return
      }
      this.responseReady = true
      this.data.onPublicationCapacity()
      input.onCapacity()
    })
  }

  publishData(span: PtySourceSpan, onSettled: (result: SinkWriteSettlement) => void): boolean {
    return this.data.publish(span, onSettled)
  }

  publishExit(exit: LegacyPtyProxyExit, onSettled: (result: SinkWriteSettlement) => void): boolean {
    if (this.disposed || !this.responseReady || this.data.hasPending || this.exitPending) {
      return false
    }
    const snapshot = this.input.session.sourceDeliverySnapshotIfKnown(this.identity)
    if (!snapshot || snapshot.sentEndSu !== exit.sourceEndSu) {
      return false
    }
    this.input.session.sealDelivery(this.identity)
    this.exitPending = true
    let callbackRan = false
    const settle = onceSettlement((result) => {
      callbackRan = true
      this.exitPending = false
      this.pendingExitSettlement = null
      try {
        this.input.session.settleExitPublication(this.identity, result)
      } catch (error) {
        onSettled({
          ok: false,
          error: error instanceof Error ? error : new Error(String(error))
        })
        return
      }
      onSettled(result)
      if (result.ok) {
        exit.authorityOutcome?.markOrderedComplete()
      }
    })
    this.pendingExitSettlement = onSettled
    const admitted = this.input.dispatcher.tryNotifyPtyExitToClient(
      this.input.context.clientId,
      {
        id: exit.id,
        incarnationId: exit.incarnationId,
        code: exit.code,
        ...(exit.authorityOutcome?.supportsClient(this.input.context.clientId)
          ? { authorityOutcome: exit.authorityOutcome.identity }
          : {})
      },
      settle
    )
    if (admitted && exit.authorityOutcome?.supportsClient(this.input.context.clientId)) {
      exit.authorityOutcome.markPublished([this.input.context.clientId])
    }
    if (!admitted && !callbackRan) {
      this.exitPending = false
      this.pendingExitSettlement = null
    }
    return admitted
  }

  acknowledgedEndSu(): number {
    return this.input.session.sourceDeliverySnapshotIfKnown(this.identity)?.creditedEndSu ?? 0
  }

  onCreditAvailable(): void {
    if (this.disposed) {
      return
    }
    this.data.onPublicationCapacity()
    this.input.onCapacity()
  }

  reopen(
    input: Omit<LegacyPhysicalWorkerDownstreamOpenInput, 'checkpointSourceEndSu'>
  ): LegacyPhysicalWorkerDownstreamOpenResult | null {
    if (!input.context?.onResponseSettled || this.disposed) {
      return null
    }
    if (!legacyPhysicalWorkerRecoveryMatches(input.sourceRecovery, this.identity)) {
      return legacyPhysicalWorkerRestoreRequired('checkpointUnavailable')
    }
    const snapshot = this.input.session.sourceDeliverySnapshotIfKnown(this.identity)
    if (!snapshot) {
      return legacyPhysicalWorkerRestoreRequired('deliveryUnavailable')
    }
    this.data.rollbackReservation()
    let rotation
    try {
      rotation = this.input.session.rotateDelivery(
        this.identity,
        input.context.clientId,
        input.sourceRecovery.acceptedSourceEndSu
      )
    } catch {
      queueMicrotask(() => this.data.onPublicationCapacity())
      return legacyPhysicalWorkerRestoreRequired('checkpointUnavailable')
    }
    const recoverySpan = this.data.retireForRotation() ?? rotation.recovery.at(-1)
    this.retireExitForRotation()
    const attachment = createLegacyPhysicalWorkerDownstreamAttachment({
      dispatcher: this.input.dispatcher,
      session: this.input.session,
      context: input.context,
      identity: rotation.identity,
      checkpointSourceEndSu: input.sourceRecovery.acceptedSourceEndSu,
      recoveryEndSu: snapshot.receivedEndSu,
      onCapacity: input.onCapacity,
      ...(recoverySpan ? { recoverySpan } : {})
    })
    return Object.freeze({
      status: 'attached',
      attachment,
      sourceRecovery: pendingLegacyPhysicalWorkerRecovery(attachment.sourceActivation)
    })
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.removeCapacityListener()
    this.data.dispose()
    try {
      this.input.session.cancelDelivery(this.identity, 'legacy-proxy-detached')
    } catch {
      /* The exact downstream delivery may already be closed by its exit. */
    }
  }

  private retireExitForRotation(): void {
    const pendingExitSettlement = this.pendingExitSettlement
    this.disposed = true
    this.removeCapacityListener()
    this.pendingExitSettlement = null
    pendingExitSettlement?.({
      ok: false,
      error: new Error('legacy PTY downstream rotated')
    })
  }
}

function onceSettlement(
  callback: (result: SinkWriteSettlement) => void
): (result: SinkWriteSettlement) => void {
  let settled = false
  return (result) => {
    if (settled) {
      return
    }
    settled = true
    callback(result)
  }
}
