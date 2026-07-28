import {
  ptySourceDeliveryKey,
  samePtySourceDelivery,
  type PtySourceDeliveryIdentity,
  type PtySourceSpan
} from '../../shared/pty-source-credit-contract'
import {
  assertNonNegativeSafeInteger,
  assertPtySourceIdentity,
  assertPtySourceSpan
} from '../../shared/pty-source-credit-validation'
import type {
  SshPtySourceAckPublication,
  SshPtySourceAdmissionReservation,
  SshPtySourceConsumerId,
  SshPtySourceObligationState,
  SshPtySourceTokenSnapshot
} from './ssh-pty-source-obligation-contract'
import { createSshPtySourceAckPublication } from './ssh-pty-source-ack-publication'
import {
  advanceSourceTerminalEnd,
  beginSourceExitTimeout,
  cancelOpenSourceObligations,
  closeAllSourceTokens,
  closeSourceGeneration,
  closeSourceToken,
  createSourceSpanRecord,
  createSourceToken,
  markSourceExitPublished,
  requireSourceSpan,
  rollbackCommittedSourceSpan,
  sealSourceToken,
  snapshotSourceToken,
  type ReservationRecord,
  type TokenRecord
} from './ssh-pty-source-obligation-state'

export type {
  SshPtySourceAckPublication,
  SshPtySourceAdmissionReservation,
  SshPtySourceConsumerId,
  SshPtySourceObligationState,
  SshPtySourceTokenSnapshot
} from './ssh-pty-source-obligation-contract'

export class SshPtySourceObligationLedger {
  private readonly tokens = new Map<string, TokenRecord>()
  private readonly closedSnapshots = new Map<string, SshPtySourceTokenSnapshot>()
  private readonly reservations = new Map<string, ReservationRecord>()
  private readonly spanOwners = new Map<string, TokenRecord>()
  private nextReservationId = 1

  constructor(
    private readonly onTokenClosed: (identity: PtySourceDeliveryIdentity) => void = () => {}
  ) {}

  open(identity: PtySourceDeliveryIdentity, checkpointSourceEndSu = 0): void {
    assertPtySourceIdentity(identity)
    assertNonNegativeSafeInteger(checkpointSourceEndSu, 'checkpointSourceEndSu')
    const key = ptySourceDeliveryKey(identity)
    if (this.tokens.has(key) || this.closedSnapshots.has(key)) {
      throw new Error('SSH PTY source token was already used')
    }
    this.tokens.set(key, createSourceToken(identity, checkpointSourceEndSu))
  }

  reserve(
    identity: PtySourceDeliveryIdentity,
    span: PtySourceSpan,
    requiredConsumers: readonly SshPtySourceConsumerId[]
  ): SshPtySourceAdmissionReservation {
    const token = this.requireToken(identity)
    if (token.state !== 'active') {
      throw new Error('SSH PTY source token no longer admits data')
    }
    assertPtySourceSpan(span)
    if (
      !samePtySourceDelivery(token.identity, span) ||
      span.sourceStartSu !== token.receivedEndSu ||
      this.spanOwners.has(span.spanId)
    ) {
      throw new Error('SSH PTY source span is stale, duplicate, or non-contiguous')
    }
    const uniqueConsumers = Array.from(new Set(requiredConsumers))
    if (!uniqueConsumers.includes('model')) {
      throw new Error('SSH PTY source span requires the terminal model obligation')
    }
    const reservation = Object.freeze({
      reservationId: `ssh-source-admission:${this.nextReservationId++}`,
      span,
      requiredConsumers: Object.freeze(uniqueConsumers)
    })
    this.reservations.set(reservation.reservationId, {
      reservation,
      state: 'reserved'
    })
    return reservation
  }

  commit(reservation: SshPtySourceAdmissionReservation): void {
    const record = this.requireReservation(reservation)
    if (record.state !== 'reserved') {
      throw new Error('SSH PTY source admission reservation is not pending')
    }
    const token = this.requireToken(reservation.span)
    if (token.state !== 'active' || token.receivedEndSu !== reservation.span.sourceStartSu) {
      throw new Error('SSH PTY source admission reservation became stale')
    }
    const spanRecord = createSourceSpanRecord(reservation.span, reservation.requiredConsumers)
    token.spans.push(spanRecord)
    token.receivedEndSu = reservation.span.sourceEndSu
    this.spanOwners.set(reservation.span.spanId, token)
    this.reservations.delete(reservation.reservationId)
  }

  rollback(reservation: SshPtySourceAdmissionReservation): boolean {
    const record = this.reservations.get(reservation.reservationId)
    if (!record || record.reservation !== reservation || record.state !== 'reserved') {
      return false
    }
    this.reservations.delete(reservation.reservationId)
    return true
  }

  rollbackCommitted(reservation: SshPtySourceAdmissionReservation): boolean {
    const token = this.tokens.get(ptySourceDeliveryKey(reservation.span))
    if (!token || !samePtySourceDelivery(token.identity, reservation.span)) {
      return false
    }
    return rollbackCommittedSourceSpan(token, reservation, this.spanOwners)
  }

  settle(spanId: string, consumer: SshPtySourceConsumerId, reason: string): boolean {
    return this.transitionOpen(spanId, consumer, Object.freeze({ state: 'settled', reason }))
  }

  beginTransfer(
    spanId: string,
    consumer: SshPtySourceConsumerId,
    to: SshPtySourceConsumerId,
    reason: string
  ): boolean {
    return this.transitionOpen(
      spanId,
      consumer,
      Object.freeze({ state: 'transferring', to, reason })
    )
  }

  commitTransfer(spanId: string, consumer: SshPtySourceConsumerId): boolean {
    const { token, span } = requireSourceSpan(this.spanOwners, spanId)
    const current = span.obligations.get(consumer)
    if (current?.state !== 'transferring') {
      return false
    }
    span.obligations.set(
      consumer,
      Object.freeze({
        state: 'transferred',
        to: current.to,
        reason: current.reason
      })
    )
    advanceSourceTerminalEnd(token)
    return true
  }

  cancelTransfer(spanId: string, consumer: SshPtySourceConsumerId, reason: string): boolean {
    const { token, span } = requireSourceSpan(this.spanOwners, spanId)
    const current = span.obligations.get(consumer)
    if (current?.state !== 'transferring') {
      return false
    }
    span.obligations.set(consumer, Object.freeze({ state: 'canceled', reason }))
    advanceSourceTerminalEnd(token)
    return true
  }

  queueAck(identity: PtySourceDeliveryIdentity): SshPtySourceAckPublication | null {
    const token = this.requireToken(identity)
    if (token.obligationsTerminalEndSu <= token.ackQueuedEndSu) {
      return null
    }
    const endSu = token.obligationsTerminalEndSu
    token.ackQueuedEndSu = endSu
    return createSshPtySourceAckPublication(token, endSu, this.spanOwners, () =>
      this.maybeClose(token)
    )
  }

  retryQueuedAck(identity: PtySourceDeliveryIdentity): SshPtySourceAckPublication | null {
    const token = this.requireToken(identity)
    if (token.ackQueuedEndSu <= token.ackPublishedEndSu) {
      return null
    }
    const endSu = token.ackQueuedEndSu
    return createSshPtySourceAckPublication(token, endSu, this.spanOwners, () =>
      this.maybeClose(token)
    )
  }

  seal(identity: PtySourceDeliveryIdentity): void {
    sealSourceToken(this.requireToken(identity))
  }

  markExitPublished(identity: PtySourceDeliveryIdentity): void {
    const token = this.requireToken(identity)
    markSourceExitPublished(token)
    this.maybeClose(token)
  }

  beginExitTimeout(identity: PtySourceDeliveryIdentity): Readonly<{
    id: string
    deliveryToken: string
    clientGeneration: number
    ownerGeneration: number
  }> {
    return beginSourceExitTimeout(this.requireToken(identity))
  }

  applyCancellationProof(
    identity: PtySourceDeliveryIdentity,
    proof: Readonly<{ sentEndSu: number; creditedEndSu: number }>
  ): void {
    const token = this.requireToken(identity)
    if (
      token.state !== 'canceling' ||
      proof.sentEndSu !== token.receivedEndSu ||
      proof.creditedEndSu !== token.ackPublishedEndSu
    ) {
      throw new Error('SSH PTY source cancellation proof is stale or invalid')
    }
    cancelOpenSourceObligations(token, 'relay-cancellation-proof')
    this.closeToken(token)
  }

  closeGeneration(providerGeneration: number, reason: string): number {
    return closeSourceGeneration(
      this.tokens,
      this.reservations,
      providerGeneration,
      reason,
      (token) => this.closeToken(token)
    )
  }

  closeAll(reason: string): number {
    return closeAllSourceTokens(this.tokens, this.reservations, reason, (token) =>
      this.closeToken(token)
    )
  }

  snapshot(identity: PtySourceDeliveryIdentity): SshPtySourceTokenSnapshot {
    const key = ptySourceDeliveryKey(identity)
    const token = this.tokens.get(key)
    if (token && samePtySourceDelivery(token.identity, identity)) {
      return snapshotSourceToken(token)
    }
    const closed = this.closedSnapshots.get(key)
    if (closed && samePtySourceDelivery(closed, identity)) {
      return closed
    }
    throw new Error('Unknown or stale SSH PTY source token')
  }

  obligation(spanId: string, consumer: SshPtySourceConsumerId): SshPtySourceObligationState {
    const obligation = requireSourceSpan(this.spanOwners, spanId).span.obligations.get(consumer)
    if (!obligation) {
      throw new Error('SSH PTY source consumer obligation does not exist')
    }
    return obligation
  }

  spanIdentity(spanId: string): PtySourceSpan {
    return requireSourceSpan(this.spanOwners, spanId).span.span
  }

  private transitionOpen(
    spanId: string,
    consumer: SshPtySourceConsumerId,
    next: SshPtySourceObligationState
  ): boolean {
    const { token, span } = requireSourceSpan(this.spanOwners, spanId)
    if (span.obligations.get(consumer)?.state !== 'open') {
      return false
    }
    span.obligations.set(consumer, next)
    advanceSourceTerminalEnd(token)
    return true
  }

  private maybeClose(token: TokenRecord): void {
    if (
      token.state === 'sealed-unsettled' &&
      token.exitPublished &&
      token.ackPublishedEndSu === token.receivedEndSu
    ) {
      this.closeToken(token)
    }
  }

  private closeToken(token: TokenRecord): void {
    closeSourceToken(
      token,
      this.tokens,
      this.closedSnapshots,
      this.reservations,
      this.spanOwners,
      this.onTokenClosed
    )
  }

  private requireReservation(reservation: SshPtySourceAdmissionReservation): ReservationRecord {
    const record = this.reservations.get(reservation.reservationId)
    if (!record || record.reservation !== reservation) {
      throw new Error('Unknown SSH PTY source admission reservation')
    }
    return record
  }

  private requireToken(identity: PtySourceDeliveryIdentity): TokenRecord {
    const token = this.tokens.get(ptySourceDeliveryKey(identity))
    if (!token || !samePtySourceDelivery(token.identity, identity)) {
      throw new Error('Unknown or stale SSH PTY source token')
    }
    return token
  }
}
