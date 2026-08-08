import {
  ptySourceSpanIsSplittable,
  type PtySourceDeliveryIdentity,
  type PtySourceSpan
} from '../shared/pty-source-credit-contract'
import type { RequestContext, SinkWriteSettlement } from './dispatcher'
import type {
  LegacyPhysicalWorkerDownstreamDispatcher,
  LegacyPhysicalWorkerDownstreamSession
} from './legacy-physical-worker-downstream-contract'
import type { PtySourceSendReservation } from './pty-source-credit-ledger'

type PendingData = {
  span: PtySourceSpan
  targetEndSu: number
  onSettled: (result: SinkWriteSettlement) => void
  sending: boolean
}

export class LegacyPhysicalWorkerDownstreamData {
  private pending: PendingData | null = null
  private reservation: PtySourceSendReservation | null = null
  private retired = false

  constructor(
    private readonly dispatcher: LegacyPhysicalWorkerDownstreamDispatcher,
    private readonly session: LegacyPhysicalWorkerDownstreamSession,
    private readonly context: RequestContext,
    private readonly identity: PtySourceDeliveryIdentity,
    private readonly canPublish: () => boolean,
    private readonly onCapacity: () => void,
    recovery?: Readonly<{ span: PtySourceSpan; endSu: number }>
  ) {
    if (recovery) {
      this.pending = {
        span: recovery.span,
        targetEndSu: recovery.endSu,
        onSettled: () => {},
        sending: false
      }
    }
  }

  get hasPending(): boolean {
    return this.pending !== null
  }

  publish(span: PtySourceSpan, onSettled: (result: SinkWriteSettlement) => void): boolean {
    if (this.retired || !this.canPublish()) {
      return false
    }
    if (this.pending) {
      if (!sameSourceSpan(this.pending.span, span)) {
        return false
      }
      this.pending.onSettled = onSettled
      this.pump()
      return true
    }
    let appended: PtySourceSpan
    try {
      appended = this.session.appendSource(this.identity, {
        spanId: span.spanId,
        data: span.data,
        displayStart: span.displayStart,
        displayEnd: span.displayEnd,
        splittable: ptySourceSpanIsSplittable(span),
        transform: span.transform
      })
    } catch {
      return false
    }
    if (
      appended.sourceStartSu !== span.sourceStartSu ||
      appended.sourceEndSu !== span.sourceEndSu
    ) {
      this.session.cancelDelivery(this.identity, 'legacy-proxy-source-sequence-mismatch')
      this.retired = true
      throw new Error('legacy PTY downstream source sequence changed')
    }
    this.pending = {
      span: Object.freeze({ ...span }),
      targetEndSu: span.sourceEndSu,
      onSettled,
      sending: false
    }
    this.pump()
    return true
  }

  onPublicationCapacity(): void {
    if (!this.retired) {
      this.pump()
    }
  }

  rollbackReservation(): void {
    if (!this.reservation) {
      return
    }
    this.session.rollbackSourceSend(this.reservation)
    this.reservation = null
    if (this.pending) {
      this.pending.sending = false
    }
  }

  retireForRotation(): PtySourceSpan | undefined {
    const pending = this.pending
    this.retired = true
    this.pending = null
    pending?.onSettled({ ok: false, error: new Error('legacy PTY downstream rotated') })
    return pending?.span
  }

  dispose(): void {
    if (this.retired) {
      return
    }
    this.retired = true
    if (this.reservation) {
      try {
        this.session.rollbackSourceSend(this.reservation)
      } catch {
        /* The transport settlement retired the reservation first. */
      }
      this.reservation = null
    }
    this.pending = null
  }

  private pump(): void {
    const pending = this.pending
    if (
      this.retired ||
      !this.canPublish() ||
      !pending ||
      pending.sending ||
      this.context.isStale()
    ) {
      return
    }
    const reservation = this.session.reserveSourceSend(this.identity)
    if (!reservation) {
      return
    }
    this.reservation = reservation
    pending.sending = true
    let callbackRan = false
    const settle = onceSettlement((result) => {
      callbackRan = true
      if (this.reservation === reservation) {
        this.reservation = null
      }
      pending.sending = false
      if (this.retired || this.pending !== pending) {
        return
      }
      if (!result.ok) {
        this.session.rollbackSourceSend(reservation)
        pending.onSettled(result)
        this.onCapacity()
        return
      }
      this.session.commitSourceSend(reservation)
      if (reservation.span.sourceEndSu >= pending.targetEndSu) {
        this.pending = null
        pending.onSettled({ ok: true })
        this.onCapacity()
        return
      }
      queueMicrotask(() => this.pump())
    })
    const admitted = this.dispatcher.tryNotifyPtyDataToClient(
      this.context.clientId,
      reservation.span as unknown as Record<string, unknown>,
      settle
    )
    if (!admitted && !callbackRan) {
      pending.sending = false
      this.reservation = null
      this.session.rollbackSourceSend(reservation)
    }
  }
}

function sameSourceSpan(left: PtySourceSpan, right: PtySourceSpan): boolean {
  return (
    left.deliveryToken === right.deliveryToken &&
    left.spanId === right.spanId &&
    left.sourceStartSu === right.sourceStartSu &&
    left.sourceEndSu === right.sourceEndSu &&
    left.data === right.data
  )
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
