import {
  assertAuthorityId,
  type TerminalAuthorityNamespace,
  type TerminalSessionBinding
} from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalAuthorityConsumerSnapshot,
  type TerminalAuthorityDurableOutcome,
  type TerminalAuthorityOutcome,
  type TerminalAuthorityOutcomeRead,
  type TerminalAuthoritySemanticOutcome,
  type TerminalSessionAuthorityLogEvent,
  type TerminalSessionAuthorityMutationRequest,
  type TerminalSessionAuthoritySemanticOutcomeRequest
} from './terminal-session-authority-mutation'
import {
  TerminalSessionAuthorityOutcomeStream,
  type TerminalAuthorityOutcomeStreamSnapshot
} from './terminal-session-authority-outcome-stream'
import { assertSafeInteger } from './terminal-session-authority-record-validation'
import { assertSemanticallyEqual } from './terminal-session-authority-semantic-equality'
import { assertConsumerSnapshotShape } from './terminal-session-authority-restore-validation'

type MutableConsumer = {
  consumerId: string
  activeIncarnationId: string
  acknowledgedSequence: number
}

export type TerminalAuthorityOutcomeJournalSnapshot = TerminalAuthorityOutcomeStreamSnapshot &
  Readonly<{ consumers: readonly TerminalAuthorityConsumerSnapshot[] }>

export class TerminalSessionAuthorityOutcomeJournal {
  private readonly consumers = new Map<string, MutableConsumer>()
  private readonly stream: TerminalSessionAuthorityOutcomeStream

  constructor(
    private readonly maxConsumers: number,
    maxEntries: number,
    maxBytes: number,
    maxSemanticProducers: number
  ) {
    this.stream = new TerminalSessionAuthorityOutcomeStream(
      maxEntries,
      maxBytes,
      maxSemanticProducers
    )
  }

  get highWatermark(): number {
    return this.stream.highWatermark
  }

  materializedProjection(): readonly TerminalAuthorityDurableOutcome[] {
    return this.stream.materializedProjection()
  }

  planClaim(
    consumerId: string,
    expectedIncarnationId: string | null,
    consumerIncarnationId: string
  ): Extract<TerminalSessionAuthorityLogEvent, { kind: 'consumer-claim' }> | null {
    assertAuthorityId(consumerId, 'consumerId')
    assertAuthorityId(consumerIncarnationId, 'consumerIncarnationId')
    const current = this.consumers.get(consumerId)
    if (current?.activeIncarnationId === consumerIncarnationId) {
      return null
    }
    if (
      current
        ? current.activeIncarnationId !== expectedIncarnationId
        : expectedIncarnationId !== null
    ) {
      failTerminalSessionAuthority('consumer-conflict', 'consumer incarnation changed')
    }
    if (!current && this.consumers.size >= this.maxConsumers) {
      failTerminalSessionAuthority('capacity', 'authority outcome consumers are full')
    }
    return Object.freeze({
      kind: 'consumer-claim',
      consumerId,
      expectedIncarnationId,
      consumerIncarnationId,
      acknowledgedSequence: current?.acknowledgedSequence ?? this.stream.highWatermark
    })
  }

  applyClaim(event: Extract<TerminalSessionAuthorityLogEvent, { kind: 'consumer-claim' }>): void {
    assertSemanticallyEqual(
      this.planClaim(event.consumerId, event.expectedIncarnationId, event.consumerIncarnationId),
      event,
      'consumer claim is not canonical'
    )
    const current = this.consumers.get(event.consumerId)
    if (current) {
      current.activeIncarnationId = event.consumerIncarnationId
    } else {
      this.consumers.set(event.consumerId, {
        consumerId: event.consumerId,
        activeIncarnationId: event.consumerIncarnationId,
        acknowledgedSequence: event.acknowledgedSequence
      })
    }
    this.compactAcknowledged()
  }

  planRetire(
    consumerId: string,
    consumerIncarnationId: string
  ): TerminalSessionAuthorityLogEvent | null {
    assertAuthorityId(consumerId, 'consumerId')
    assertAuthorityId(consumerIncarnationId, 'consumerIncarnationId')
    const current = this.consumers.get(consumerId)
    if (!current) {
      return null
    }
    this.requireExactConsumer(consumerId, consumerIncarnationId)
    return Object.freeze({ kind: 'consumer-retire', consumerId, consumerIncarnationId })
  }

  applyRetire(event: Extract<TerminalSessionAuthorityLogEvent, { kind: 'consumer-retire' }>): void {
    assertSemanticallyEqual(
      this.planRetire(event.consumerId, event.consumerIncarnationId),
      event,
      'consumer retirement is not canonical'
    )
    this.consumers.delete(event.consumerId)
    this.compactAcknowledged()
  }

  findMutation(
    request: TerminalSessionAuthorityMutationRequest,
    replayFloorRevision: number
  ): TerminalAuthorityOutcome | null {
    return this.stream.findMutation(request, replayFloorRevision)
  }

  findSemantic(
    request: TerminalSessionAuthoritySemanticOutcomeRequest
  ): TerminalAuthoritySemanticOutcome | null {
    return this.stream.findSemantic(request)
  }

  nextSequence(outcomeId: string): number {
    return this.stream.nextSequence(outcomeId)
  }

  assertCanAppend(outcome: TerminalAuthorityDurableOutcome): void {
    this.stream.assertCanAppend(outcome)
  }

  applyOutcome(outcome: TerminalAuthorityDurableOutcome): void {
    this.stream.applyOutcome(outcome)
  }

  retireSemanticProducers(binding: TerminalSessionBinding): void {
    this.stream.retireSemanticProducers(binding)
  }

  planAck(
    consumerId: string,
    consumerIncarnationId: string,
    sequence: number
  ): TerminalSessionAuthorityLogEvent | null {
    const consumer = this.requireExactConsumer(consumerId, consumerIncarnationId)
    assertSafeInteger(sequence, 'outcome ACK sequence')
    if (sequence <= consumer.acknowledgedSequence) {
      return null
    }
    if (sequence > this.stream.highWatermark) {
      failTerminalSessionAuthority('expectation-mismatch', 'ACK advances beyond the outcome tail')
    }
    for (let candidate = consumer.acknowledgedSequence + 1; candidate <= sequence; candidate++) {
      if (!this.stream.has(candidate)) {
        failTerminalSessionAuthority('record-corrupt', 'outcome ACK crosses a journal gap')
      }
    }
    return Object.freeze({ kind: 'outcome-ack', consumerId, consumerIncarnationId, sequence })
  }

  applyAck(event: Extract<TerminalSessionAuthorityLogEvent, { kind: 'outcome-ack' }>): void {
    assertSemanticallyEqual(
      this.planAck(event.consumerId, event.consumerIncarnationId, event.sequence),
      event,
      'outcome ACK is not canonical'
    )
    this.requireConsumer(event.consumerId).acknowledgedSequence = event.sequence
    this.compactAcknowledged()
  }

  read(
    consumerId: string,
    consumerIncarnationId: string,
    afterSequence: number,
    limit: number
  ): TerminalAuthorityOutcomeRead {
    const consumer = this.requireExactConsumer(consumerId, consumerIncarnationId)
    assertSafeInteger(afterSequence, 'outcome cursor')
    assertSafeInteger(limit, 'outcome read limit', 1)
    if (afterSequence < consumer.acknowledgedSequence) {
      return resnapshot('cursor-compacted', consumer.acknowledgedSequence)
    }
    if (afterSequence > this.stream.highWatermark) {
      return resnapshot('cursor-ahead', consumer.acknowledgedSequence)
    }
    const entries = this.stream.read(afterSequence, limit)
    return entries
      ? Object.freeze({ kind: 'entries', entries: Object.freeze(structuredClone(entries)) })
      : resnapshot('cursor-gap', consumer.acknowledgedSequence)
  }

  cursor(
    consumerId: string,
    incarnationId: string
  ): Readonly<{ acknowledgedSequence: number; outcomeHighWatermark: number }> {
    const consumer = this.requireExactConsumer(consumerId, incarnationId)
    return {
      acknowledgedSequence: consumer.acknowledgedSequence,
      outcomeHighWatermark: this.stream.highWatermark
    }
  }

  activeIncarnation(consumerId: string): string | null {
    return this.consumers.get(consumerId)?.activeIncarnationId ?? null
  }

  get hasConsumers(): boolean {
    return this.consumers.size > 0
  }

  snapshot(): TerminalAuthorityOutcomeJournalSnapshot {
    return Object.freeze({
      consumers: Object.freeze(
        [...this.consumers.values()]
          .sort((left, right) => left.consumerId.localeCompare(right.consumerId))
          .map((consumer) => Object.freeze({ ...consumer }))
      ),
      ...this.stream.snapshot()
    })
  }

  restore(
    snapshot: TerminalAuthorityOutcomeJournalSnapshot,
    namespace: TerminalAuthorityNamespace,
    revision: number
  ): void {
    this.stream.restore(snapshot, namespace, revision)
    for (const consumer of snapshot.consumers) {
      this.restoreConsumer(consumer)
    }
    // With consumers the floor is exactly their minimum cursor. With none it is wherever the last
    // retirement left it — or still 0 on a namespace that has only ever been observed, since an
    // observer never claims and so never compacts.
    const cursorFloor = this.minimumConsumerCursor()
    const floorIsDurable =
      cursorFloor === null
        ? this.stream.floorSequence <= this.stream.highWatermark
        : cursorFloor === this.stream.floorSequence
    if (!floorIsDurable) {
      failTerminalSessionAuthority(
        'record-corrupt',
        'outcome floor is not the durable cursor floor'
      )
    }
  }

  private restoreConsumer(snapshot: TerminalAuthorityConsumerSnapshot): void {
    assertConsumerSnapshotShape(snapshot)
    if (
      this.consumers.has(snapshot.consumerId) ||
      this.consumers.size >= this.maxConsumers ||
      snapshot.acknowledgedSequence < this.stream.floorSequence ||
      snapshot.acknowledgedSequence > this.stream.highWatermark
    ) {
      failTerminalSessionAuthority('record-corrupt', 'consumer cursor is inconsistent')
    }
    this.consumers.set(snapshot.consumerId, { ...snapshot })
  }

  private compactAcknowledged(): void {
    this.stream.compactThrough(this.minimumConsumerCursor() ?? this.stream.highWatermark)
  }

  private minimumConsumerCursor(): number | null {
    let minimum: number | null = null
    for (const consumer of this.consumers.values()) {
      minimum = Math.min(minimum ?? consumer.acknowledgedSequence, consumer.acknowledgedSequence)
    }
    return minimum
  }

  private requireConsumer(consumerId: string): MutableConsumer {
    const consumer = this.consumers.get(consumerId)
    if (!consumer) {
      failTerminalSessionAuthority('consumer-unknown', 'outcome consumer is not claimed')
    }
    return consumer
  }

  private requireExactConsumer(consumerId: string, incarnationId: string): MutableConsumer {
    const consumer = this.requireConsumer(consumerId)
    if (consumer.activeIncarnationId !== incarnationId) {
      failTerminalSessionAuthority('consumer-conflict', 'consumer incarnation is stale')
    }
    return consumer
  }
}

function resnapshot(
  reason: Extract<TerminalAuthorityOutcomeRead, { kind: 'resnapshot-required' }>['reason'],
  acknowledgedSequence: number
): TerminalAuthorityOutcomeRead {
  return Object.freeze({ kind: 'resnapshot-required', reason, acknowledgedSequence })
}
