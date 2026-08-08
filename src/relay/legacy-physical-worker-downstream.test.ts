import { describe, expect, it, vi } from 'vitest'
import type {
  PtySourceDeliveryIdentity,
  PtySourceDeliverySnapshot,
  PtySourceSpan
} from '../shared/pty-source-credit-contract'
import type { RequestContext, SinkWriteSettlement } from './dispatcher'
import { LegacyPhysicalWorkerDownstream } from './legacy-physical-worker-downstream'
import type { PtySourceSendReservation } from './pty-source-credit-ledger'

describe('legacy physical worker downstream', () => {
  it('opens restart recovery only from the exact durable downstream cursor', () => {
    const session = new DownstreamSession()
    const dispatcher = new DownstreamDispatcher()
    const downstream = new LegacyPhysicalWorkerDownstream(dispatcher, session)

    expect(
      downstream.open({
        id: 'pty-1',
        incarnationId: 'incarnation-1',
        checkpointSourceEndSu: 4,
        sourceRecovery: recovery(oldIdentity, 4),
        durableDownstreamIdentity: oldIdentity,
        context: requestContext(8),
        onCapacity: () => {}
      })
    ).toMatchObject({
      status: 'attached',
      sourceRecovery: {
        status: 'pending',
        deliveryToken: 'new-token',
        checkpointSourceEndSu: 4,
        recoveryEndSu: 4
      }
    })
    expect(session.openDelivery).toHaveBeenCalledWith(8, 'pty-1', 'incarnation-1', 4)

    expect(
      downstream.open({
        id: 'pty-1',
        incarnationId: 'incarnation-1',
        checkpointSourceEndSu: 4,
        sourceRecovery: recovery({ ...oldIdentity, deliveryToken: 'stale' }, 4),
        durableDownstreamIdentity: oldIdentity,
        context: requestContext(9),
        onCapacity: () => {}
      })
    ).toEqual({
      status: 'restore-required',
      sourceRecovery: { status: 'restoreRequired', reason: 'checkpointUnavailable' }
    })
    expect(session.openDelivery).toHaveBeenCalledOnce()
  })

  it('rotates a live delivery and replays retained output before accepting new data', () => {
    const session = new DownstreamSession()
    const dispatcher = new DownstreamDispatcher()
    const firstContext = requestContext(8)
    const downstream = new LegacyPhysicalWorkerDownstream(dispatcher, session)
    const opened = downstream.open({
      id: 'pty-1',
      incarnationId: 'incarnation-1',
      checkpointSourceEndSu: 0,
      context: firstContext,
      onCapacity: () => {}
    })
    expect(opened?.status).toBe('attached')
    if (!opened || opened.status !== 'attached') {
      return
    }
    settleResponse(firstContext, { ok: true })
    session.snapshot = deliverySnapshot(opened.attachment.identity, 4)
    session.rotationRecovery = [sourceSpan(replacementIdentity, 0, 4, 'four')]
    const secondContext = requestContext(9)

    const reopened = opened.attachment.reopen({
      id: 'pty-1',
      incarnationId: 'incarnation-1',
      sourceRecovery: recovery(opened.attachment.identity, 0),
      context: secondContext,
      onCapacity: () => {}
    })
    expect(reopened).toMatchObject({
      status: 'attached',
      sourceRecovery: {
        checkpointSourceEndSu: 0,
        recoveryEndSu: 4,
        deliveryToken: 'replacement-token'
      }
    })
    expect(session.rotateDelivery).toHaveBeenCalledWith(opened.attachment.identity, 9, 0)
    settleResponse(secondContext, { ok: true })
    expect(dispatcher.data.map((span) => span.data)).toEqual(['four'])
    expect(opened.attachment.publishData(sourceSpan(oldIdentity, 4, 8, 'next'), () => {})).toBe(
      false
    )
  })
})

class DownstreamDispatcher {
  readonly data: PtySourceSpan[] = []

  onClientCapacity(): () => void {
    return () => {}
  }

  tryNotifyPtyDataToClient(
    _clientId: number,
    params: Record<string, unknown>,
    settle: (result: SinkWriteSettlement) => void
  ): boolean {
    this.data.push(params as unknown as PtySourceSpan)
    settle({ ok: true })
    return true
  }

  tryNotifyPtyExitToClient(
    _clientId: number,
    _params: Record<string, unknown>,
    settle: (result: SinkWriteSettlement) => void
  ): boolean {
    settle({ ok: true })
    return true
  }
}

class DownstreamSession {
  snapshot: PtySourceDeliverySnapshot | null = null
  rotationRecovery: PtySourceSpan[] = []
  private reservationSent = false
  readonly openDelivery = vi.fn(
    (_clientId: number, _id: string, _incarnationId: string, _checkpoint = 0) => newIdentity
  )
  readonly rotateDelivery = vi.fn((old: PtySourceDeliveryIdentity, _clientId: number) => {
    this.reservationSent = false
    return Object.freeze({
      identity: replacementIdentity,
      cancellation: Object.freeze({
        ...old,
        reason: 'superseded',
        sentEndSu: 4,
        creditedEndSu: 0,
        remainingStartSu: 0,
        remainingEndSu: 4,
        replacementDeliveryToken: replacementIdentity.deliveryToken
      }),
      recovery: Object.freeze(this.rotationRecovery)
    })
  })

  appendSource(): PtySourceSpan {
    throw new Error('unexpected append')
  }

  reserveSourceSend(identity: PtySourceDeliveryIdentity): PtySourceSendReservation | null {
    const span = this.rotationRecovery[0]
    if (identity !== replacementIdentity || !span || this.reservationSent) {
      return null
    }
    this.reservationSent = true
    return Object.freeze({ reservationId: 'reservation-1', identity, span })
  }

  commitSourceSend(): void {}

  rollbackSourceSend(): void {
    this.reservationSent = false
  }

  sealDelivery(): void {}

  settleExitPublication(): void {}

  sourceDeliverySnapshotIfKnown(): PtySourceDeliverySnapshot | null {
    return this.snapshot
  }

  cancelDelivery(): void {}
}

function requestContext(clientId: number): RequestContext & {
  settlements: ((result: SinkWriteSettlement) => void)[]
} {
  const settlements: ((result: SinkWriteSettlement) => void)[] = []
  return {
    clientId,
    isStale: () => false,
    onResponseSettled: (listener) => settlements.push(listener),
    settlements
  }
}

function settleResponse(
  context: ReturnType<typeof requestContext>,
  result: SinkWriteSettlement
): void {
  context.settlements.forEach((settle) => settle(result))
}

function recovery(identity: PtySourceDeliveryIdentity, acceptedSourceEndSu: number) {
  return Object.freeze({
    status: 'checkpoint' as const,
    clientGeneration: identity.clientGeneration,
    ownerGeneration: identity.ownerGeneration,
    ptyIncarnation: identity.ptyIncarnation,
    deliveryToken: identity.deliveryToken,
    acceptedSourceEndSu
  })
}

function deliverySnapshot(
  identity: PtySourceDeliveryIdentity,
  receivedEndSu: number
): PtySourceDeliverySnapshot {
  return Object.freeze({
    ...identity,
    state: 'active',
    windowSu: 1024,
    receivedEndSu,
    sentEndSu: receivedEndSu,
    creditedEndSu: 0,
    exitPublished: false,
    generationClosed: false
  })
}

function sourceSpan(
  identity: PtySourceDeliveryIdentity,
  sourceStartSu: number,
  sourceEndSu: number,
  data: string
): PtySourceSpan {
  return Object.freeze({
    ...identity,
    spanId: `span-${sourceEndSu}`,
    sourceStartSu,
    sourceEndSu,
    displayStart: sourceStartSu,
    displayEnd: sourceEndSu,
    data,
    splittable: true,
    transform: Object.freeze({
      transformed: false,
      rawLengthSu: sourceEndSu - sourceStartSu,
      scalarSafe: true
    })
  })
}

const oldIdentity: PtySourceDeliveryIdentity = Object.freeze({
  id: 'pty-1',
  providerGeneration: 1,
  clientGeneration: 2,
  ownerGeneration: 3,
  ptyIncarnation: 'incarnation-1',
  deliveryToken: 'old-token'
})

const newIdentity: PtySourceDeliveryIdentity = Object.freeze({
  ...oldIdentity,
  clientGeneration: 8,
  ownerGeneration: 6,
  deliveryToken: 'new-token'
})

const replacementIdentity: PtySourceDeliveryIdentity = Object.freeze({
  ...oldIdentity,
  clientGeneration: 9,
  ownerGeneration: 7,
  deliveryToken: 'replacement-token'
})
