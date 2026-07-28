import {
  ptySourceDeliveryKey,
  ptySourceSpanIsSplittable,
  samePtySourceDelivery,
  type PtySourceCreditAck,
  type PtySourceDeliveryCancellation,
  type PtySourceDeliveryIdentity,
  type PtySourceDeliverySnapshot,
  type PtySourceSpan
} from '../shared/pty-source-credit-contract'
import {
  assertNonNegativeSafeInteger,
  assertPositiveSafeInteger,
  assertPtySourceAck,
  assertPtySourceIdentity
} from '../shared/pty-source-credit-validation'
import {
  CLOSED_DELIVERY_TOMBSTONE_LIMIT,
  closeDeliveryGeneration,
  createAppendedSourceSpan,
  createDeliveryCancellation,
  createDeliveryRecord,
  createReplacementDeliveryRecord,
  DEFAULT_AGGREGATE_RETAINED_SOURCE_SU,
  DEFAULT_RETAINED_SOURCE_SU,
  ptyOwnerKey,
  reclaimCreditedSpans,
  retainedSourceTotal,
  sliceForSend,
  snapshotDeliveryRecord,
  type DeliveryRecord,
  type PtySourceAppendInput,
  type PtySourceSendReservation
} from './pty-source-credit-record'

export type { PtySourceSendReservation } from './pty-source-credit-record'

export type PtySourceAckResult = 'advanced' | 'duplicate' | 'regression'

export type PtySourceCreditLedgerOptions = {
  maxRetainedSourceSu?: number
  maxAggregateRetainedSourceSu?: number
}

export class RelayPtySourceCreditLedger {
  private readonly deliveries = new Map<string, DeliveryRecord>()
  private readonly upstreamOwnerByPty = new Map<string, string>()
  private readonly closedSnapshots = new Map<string, PtySourceDeliverySnapshot>()
  private readonly maxRetainedSourceSu: number
  private readonly maxAggregateRetainedSourceSu: number
  private nextReservationId = 1

  constructor(options: PtySourceCreditLedgerOptions = {}) {
    const maxRetainedSourceSu = options.maxRetainedSourceSu ?? DEFAULT_RETAINED_SOURCE_SU
    assertPositiveSafeInteger(maxRetainedSourceSu, 'maxRetainedSourceSu')
    const maxAggregateRetainedSourceSu =
      options.maxAggregateRetainedSourceSu ?? DEFAULT_AGGREGATE_RETAINED_SOURCE_SU
    assertPositiveSafeInteger(maxAggregateRetainedSourceSu, 'maxAggregateRetainedSourceSu')
    this.maxRetainedSourceSu = maxRetainedSourceSu
    this.maxAggregateRetainedSourceSu = maxAggregateRetainedSourceSu
  }

  open(
    identity: PtySourceDeliveryIdentity,
    windowSu: number,
    checkpointSourceEndSu = 0
  ): PtySourceDeliverySnapshot {
    assertPtySourceIdentity(identity)
    assertPositiveSafeInteger(windowSu, 'windowSu')
    assertNonNegativeSafeInteger(checkpointSourceEndSu, 'checkpointSourceEndSu')
    const key = ptySourceDeliveryKey(identity)
    if (this.deliveries.has(key) || this.closedSnapshots.has(key)) {
      throw new Error('PTY source delivery token was already used')
    }
    const ownerKey = ptyOwnerKey(identity)
    if (this.upstreamOwnerByPty.has(ownerKey)) {
      throw new Error('PTY source delivery already has an upstream owner')
    }
    const record = createDeliveryRecord(identity, windowSu, checkpointSourceEndSu)
    this.deliveries.set(key, record)
    this.upstreamOwnerByPty.set(ownerKey, key)
    return snapshotDeliveryRecord(record)
  }

  append(identity: PtySourceDeliveryIdentity, input: PtySourceAppendInput): PtySourceSpan {
    const record = this.requireActive(identity)
    const sourceEndSu = record.receivedEndSu + input.transform.rawLengthSu
    if (sourceEndSu - record.creditedEndSu > this.maxRetainedSourceSu) {
      throw new Error('PTY source retained-range budget exceeded')
    }
    if (this.retainedSourceSu() + input.transform.rawLengthSu > this.maxAggregateRetainedSourceSu) {
      throw new Error('Aggregate PTY source retained-range budget exceeded')
    }
    const span = createAppendedSourceSpan(record, input)
    record.spans.push(span)
    record.receivedEndSu = sourceEndSu
    return span
  }

  reserveNextSend(
    identity: PtySourceDeliveryIdentity,
    maxSourceSu = 16 * 1024
  ): PtySourceSendReservation | null {
    assertPositiveSafeInteger(maxSourceSu, 'maxSourceSu')
    const record = this.requireDelivery(identity)
    if (record.state !== 'active' && record.state !== 'sealed-unsettled') {
      return null
    }
    if (record.pendingSend) {
      throw new Error('PTY source delivery already has a pending send reservation')
    }
    const remainingWindowSu = record.windowSu - (record.sentEndSu - record.creditedEndSu)
    if (remainingWindowSu <= 0 || record.sentEndSu >= record.receivedEndSu) {
      return null
    }
    const containing = record.spans.find(
      (span) => span.sourceStartSu <= record.sentEndSu && span.sourceEndSu > record.sentEndSu
    )
    if (!containing) {
      throw new Error('PTY source delivery cursor is not covered by the retained ledger')
    }
    const available = Math.min(remainingWindowSu, maxSourceSu)
    if (
      (!ptySourceSpanIsSplittable(containing) || containing.transform.transformed) &&
      containing.sourceEndSu - record.sentEndSu > available
    ) {
      return null
    }
    const span = sliceForSend(containing, record.sentEndSu, available)
    const reservation = Object.freeze({
      reservationId: `pty-source-send:${this.nextReservationId++}`,
      identity: record.identity,
      span
    })
    record.pendingSend = reservation
    return reservation
  }

  commitSend(reservation: PtySourceSendReservation): void {
    const record = this.requireDelivery(reservation.identity)
    if (record.pendingSend !== reservation) {
      throw new Error('PTY source send reservation is stale')
    }
    record.pendingSend = null
    record.sentEndSu = reservation.span.sourceEndSu
    record.sentBoundaries.add(record.sentEndSu)
  }

  rollbackSend(reservation: PtySourceSendReservation): void {
    const record = this.requireDelivery(reservation.identity)
    if (record.pendingSend === reservation) {
      record.pendingSend = null
    }
  }

  acknowledge(identity: PtySourceDeliveryIdentity, ack: PtySourceCreditAck): PtySourceAckResult {
    assertPtySourceAck(ack)
    const record = this.requireDelivery(identity)
    if (record.state === 'closed' || record.state === 'closing') {
      throw new Error('PTY source ACK targets a closed delivery')
    }
    if (
      ack.id !== record.identity.id ||
      ack.clientGeneration !== record.identity.clientGeneration ||
      ack.ownerGeneration !== record.identity.ownerGeneration ||
      ack.deliveryToken !== record.identity.deliveryToken
    ) {
      throw new Error('PTY source ACK does not own this delivery')
    }
    if (ack.creditedEndSu > record.sentEndSu) {
      throw new Error('PTY source ACK exceeds sent source credit')
    }
    if (ack.creditedEndSu === record.creditedEndSu) {
      return 'duplicate'
    }
    if (ack.creditedEndSu < record.creditedEndSu) {
      return 'regression'
    }
    if (!record.sentBoundaries.has(ack.creditedEndSu)) {
      throw new Error('PTY source ACK does not match a committed send boundary')
    }
    record.creditedEndSu = ack.creditedEndSu
    for (const boundary of record.sentBoundaries) {
      if (boundary < record.creditedEndSu) {
        record.sentBoundaries.delete(boundary)
      }
    }
    reclaimCreditedSpans(record)
    this.maybeClose(record)
    return 'advanced'
  }

  seal(identity: PtySourceDeliveryIdentity): void {
    const record = this.requireActive(identity)
    record.state = 'sealed-unsettled'
  }

  settleExitPublication(
    identity: PtySourceDeliveryIdentity,
    result: { ok: true } | { ok: false; error: Error }
  ): void {
    const record = this.requireDelivery(identity)
    if (record.state !== 'sealed-unsettled') {
      throw new Error('PTY source delivery is not sealed')
    }
    if (!result.ok) {
      record.state = 'closing'
      return
    }
    if (record.pendingSend || record.sentEndSu !== record.receivedEndSu) {
      throw new Error('PTY source exit cannot publish ahead of preceding source data')
    }
    record.exitPublished = true
    this.maybeClose(record)
  }

  cancel(
    identity: PtySourceDeliveryIdentity,
    reason: string,
    replacementDeliveryToken?: string
  ): PtySourceDeliveryCancellation {
    const record = this.requireDelivery(identity)
    record.state = 'closing'
    const proof = createDeliveryCancellation(record, reason, replacementDeliveryToken)
    this.closeRecord(record)
    return proof
  }

  closeGeneration(providerGeneration: number): number {
    assertPositiveSafeInteger(providerGeneration, 'providerGeneration')
    return closeDeliveryGeneration(this.deliveries.values(), providerGeneration, (record) =>
      this.closeRecord(record)
    )
  }

  rotate(
    oldIdentity: PtySourceDeliveryIdentity,
    newIdentity: PtySourceDeliveryIdentity,
    acceptedSourceEndSu: number,
    windowSu: number
  ): Readonly<{ cancellation: PtySourceDeliveryCancellation; recovery: readonly PtySourceSpan[] }> {
    const old = this.requireDelivery(oldIdentity)
    const replacement = createReplacementDeliveryRecord(
      old,
      newIdentity,
      acceptedSourceEndSu,
      windowSu
    )
    const replacementKey = ptySourceDeliveryKey(newIdentity)
    if (this.deliveries.has(replacementKey) || this.closedSnapshots.has(replacementKey)) {
      throw new Error('PTY source replacement token was already used')
    }
    this.upstreamOwnerByPty.delete(ptyOwnerKey(old.identity))
    this.deliveries.set(replacementKey, replacement)
    this.upstreamOwnerByPty.set(ptyOwnerKey(replacement.identity), replacementKey)
    const cancellation = this.cancel(oldIdentity, 'superseded', newIdentity.deliveryToken)
    return Object.freeze({ cancellation, recovery: Object.freeze(replacement.spans.slice()) })
  }

  snapshot(identity: PtySourceDeliveryIdentity): PtySourceDeliverySnapshot {
    const active = this.deliveries.get(ptySourceDeliveryKey(identity))
    if (active && samePtySourceDelivery(active.identity, identity)) {
      return snapshotDeliveryRecord(active)
    }
    const closed = this.closedSnapshots.get(ptySourceDeliveryKey(identity))
    if (closed && samePtySourceDelivery(closed, identity)) {
      return closed
    }
    throw new Error('Unknown or stale PTY source delivery')
  }

  retainedSourceSu(): number {
    return retainedSourceTotal(this.deliveries.values())
  }

  private requireActive(identity: PtySourceDeliveryIdentity): DeliveryRecord {
    const record = this.requireDelivery(identity)
    if (record.state !== 'active') {
      throw new Error('PTY source delivery does not admit new source')
    }
    return record
  }

  private requireDelivery(identity: PtySourceDeliveryIdentity): DeliveryRecord {
    const record = this.deliveries.get(ptySourceDeliveryKey(identity))
    if (!record || !samePtySourceDelivery(record.identity, identity)) {
      throw new Error('Unknown or stale PTY source delivery')
    }
    return record
  }

  private maybeClose(record: DeliveryRecord): void {
    if (
      record.state === 'sealed-unsettled' &&
      record.exitPublished &&
      record.creditedEndSu === record.receivedEndSu
    ) {
      this.closeRecord(record)
    }
  }

  private closeRecord(record: DeliveryRecord): void {
    record.state = 'closed'
    record.pendingSend = null
    record.spans = []
    const key = ptySourceDeliveryKey(record.identity)
    const ownerKey = ptyOwnerKey(record.identity)
    if (this.upstreamOwnerByPty.get(ownerKey) === key) {
      this.upstreamOwnerByPty.delete(ownerKey)
    }
    this.deliveries.delete(key)
    this.closedSnapshots.set(key, snapshotDeliveryRecord(record))
    while (this.closedSnapshots.size > CLOSED_DELIVERY_TOMBSTONE_LIMIT) {
      this.closedSnapshots.delete(this.closedSnapshots.keys().next().value!)
    }
  }
}
