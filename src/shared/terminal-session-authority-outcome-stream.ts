import {
  assertAuthorityId,
  sameTerminalBinding,
  type TerminalAuthorityNamespace,
  type TerminalSessionBinding
} from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalAuthorityDurableOutcome,
  type TerminalAuthorityOutcome,
  type TerminalAuthoritySemanticOutcome,
  type TerminalAuthoritySemanticProducerSnapshot,
  type TerminalSessionAuthorityMutationRequest,
  type TerminalSessionAuthoritySemanticOutcomeRequest
} from './terminal-session-authority-mutation'
import { assertTerminalAuthorityOperationIdentity } from './terminal-session-authority-operation-identity'
import type { TerminalSessionAuthorityPtyAccess } from './terminal-session-authority-pty-access'
import { TerminalSessionAuthorityMaterializedOutcomes } from './terminal-session-authority-materialized-outcomes'
import { assertSafeInteger } from './terminal-session-authority-record-validation'
import {
  assertSemanticProducerSnapshotShape,
  validateRestoredOutcome
} from './terminal-session-authority-restore-validation'
import {
  mutationOperationKey,
  mutationRequestOperationKey,
  sameOperationRequest,
  semanticOperationKey,
  semanticOutcomeOperationKey,
  semanticProducerKey
} from './terminal-session-authority-outcome-keys'

type MutableSemanticProducer = {
  access: TerminalSessionAuthorityPtyAccess
  producerIncarnationId: string
  producerSequence: number
}

export type TerminalAuthorityOutcomeStreamSnapshot = Readonly<{
  outcomeFloorSequence: number
  nextOutcomeSequence: number
  outcomes: readonly TerminalAuthorityDurableOutcome[]
  semanticProducers: readonly TerminalAuthoritySemanticProducerSnapshot[]
  materializedOutcomes?: readonly TerminalAuthorityDurableOutcome[]
}>

export class TerminalSessionAuthorityOutcomeStream {
  private readonly outcomes = new Map<number, TerminalAuthorityDurableOutcome>()
  private readonly outcomesById = new Map<string, TerminalAuthorityDurableOutcome>()
  private readonly operations = new Map<string, TerminalAuthorityOutcome>()
  private readonly semanticOperations = new Map<string, TerminalAuthoritySemanticOutcome>()
  private readonly semanticProducers = new Map<string, MutableSemanticProducer>()
  private readonly materialized: TerminalSessionAuthorityMaterializedOutcomes
  private floorSequenceValue = 0
  private nextSequenceValue = 1
  private retainedBytes = 0

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
    private readonly maxSemanticProducers: number
  ) {
    this.materialized = new TerminalSessionAuthorityMaterializedOutcomes(maxEntries, maxBytes)
  }

  get floorSequence(): number {
    return this.floorSequenceValue
  }

  get highWatermark(): number {
    return this.nextSequenceValue - 1
  }

  materializedProjection(): readonly TerminalAuthorityDurableOutcome[] {
    return this.materialized.projection()
  }

  has(sequence: number): boolean {
    return this.outcomes.has(sequence)
  }

  read(afterSequence: number, limit: number): readonly TerminalAuthorityDurableOutcome[] | null {
    const entries: TerminalAuthorityDurableOutcome[] = []
    const last = Math.min(this.highWatermark, afterSequence + limit)
    for (let sequence = afterSequence + 1; sequence <= last; sequence++) {
      const outcome = this.outcomes.get(sequence)
      if (!outcome) {
        return null
      }
      entries.push(outcome)
    }
    return entries
  }

  findMutation(
    request: TerminalSessionAuthorityMutationRequest,
    replayFloorRevision: number
  ): TerminalAuthorityOutcome | null {
    assertTerminalAuthorityOperationIdentity(request)
    const existing = this.operations.get(mutationRequestOperationKey(request))
    if (existing && !sameOperationRequest(existing.request, request)) {
      failTerminalSessionAuthority('operation-conflict', 'operation ID was reused')
    }
    if (!existing && request.baseRevision + 1 <= replayFloorRevision) {
      failTerminalSessionAuthority('operation-conflict', 'operation outcome was compacted')
    }
    return existing ?? null
  }

  findSemantic(
    request: TerminalSessionAuthoritySemanticOutcomeRequest
  ): TerminalAuthoritySemanticOutcome | null {
    const operationKey = semanticOperationKey(
      request.access,
      request.producerIncarnationId,
      request.producerSequence
    )
    const existing = this.semanticOperations.get(operationKey)
    if (existing) {
      return existing
    }
    const producer = this.semanticProducers.get(
      semanticProducerKey(request.access, request.producerIncarnationId)
    )
    if (producer && request.producerSequence <= producer.producerSequence) {
      failTerminalSessionAuthority('operation-conflict', 'semantic outcome was compacted')
    }
    return null
  }

  nextSequence(outcomeId: string): number {
    assertAuthorityId(outcomeId, 'outcomeId')
    if (this.outcomesById.has(outcomeId)) {
      failTerminalSessionAuthority('operation-conflict', 'outcome ID was reused')
    }
    return this.nextSequenceValue
  }

  assertCanAppend(outcome: TerminalAuthorityDurableOutcome): void {
    if (
      this.outcomes.size + 1 > this.maxEntries ||
      this.retainedBytes + outcome.byteLength > this.maxBytes
    ) {
      failTerminalSessionAuthority('capacity', 'durable outcome retention is full')
    }
    this.materialized.assertCanApply(outcome)
    if (outcome.kind !== 'semantic') {
      return
    }
    const producer = this.semanticProducers.get(
      semanticProducerKey(outcome.access, outcome.producerIncarnationId)
    )
    if (!producer && this.semanticProducers.size >= this.maxSemanticProducers) {
      failTerminalSessionAuthority('capacity', 'semantic outcome producers are full')
    }
    if (outcome.producerSequence !== (producer?.producerSequence ?? 0) + 1) {
      failTerminalSessionAuthority('expectation-mismatch', 'semantic producer sequence has a gap')
    }
  }

  applyOutcome(outcome: TerminalAuthorityDurableOutcome): void {
    if (outcome.sequence !== this.nextSequenceValue) {
      failTerminalSessionAuthority('record-corrupt', 'outcome journal is not contiguous')
    }
    this.assertCanAppend(outcome)
    this.registerOutcome(outcome)
    if (outcome.kind === 'semantic') {
      this.semanticProducers.set(
        semanticProducerKey(outcome.access, outcome.producerIncarnationId),
        {
          access: outcome.access,
          producerIncarnationId: outcome.producerIncarnationId,
          producerSequence: outcome.producerSequence
        }
      )
    }
    this.materialized.apply(outcome)
    this.nextSequenceValue += 1
  }

  retireSemanticProducers(binding: TerminalSessionBinding): void {
    for (const [key, producer] of this.semanticProducers) {
      if (sameTerminalBinding(producer.access.binding, binding)) {
        this.semanticProducers.delete(key)
      }
    }
  }

  compactThrough(floor: number): void {
    if (floor <= this.floorSequenceValue) {
      return
    }
    for (let sequence = this.floorSequenceValue + 1; sequence <= floor; sequence++) {
      const outcome = this.outcomes.get(sequence)
      if (!outcome) {
        failTerminalSessionAuthority('record-corrupt', 'outcome compaction crossed a journal gap')
      }
      this.removeOutcome(outcome)
    }
    this.floorSequenceValue = floor
  }

  snapshot(): TerminalAuthorityOutcomeStreamSnapshot {
    return Object.freeze({
      outcomeFloorSequence: this.floorSequenceValue,
      nextOutcomeSequence: this.nextSequenceValue,
      outcomes: Object.freeze([...this.outcomes.values()]),
      materializedOutcomes: this.materialized.projection(),
      semanticProducers: Object.freeze(
        [...this.semanticProducers.values()]
          .sort((left, right) =>
            semanticProducerKey(left.access, left.producerIncarnationId).localeCompare(
              semanticProducerKey(right.access, right.producerIncarnationId)
            )
          )
          .map((producer) => Object.freeze(structuredClone(producer)))
      )
    })
  }

  restore(
    snapshot: TerminalAuthorityOutcomeStreamSnapshot,
    namespace: TerminalAuthorityNamespace,
    revision: number
  ): void {
    assertSafeInteger(snapshot.outcomeFloorSequence, 'outcome floor sequence')
    assertSafeInteger(snapshot.nextOutcomeSequence, 'next outcome sequence', 1)
    if (snapshot.outcomeFloorSequence >= snapshot.nextOutcomeSequence) {
      failTerminalSessionAuthority('record-corrupt', 'outcome journal cursor is inconsistent')
    }
    this.floorSequenceValue = snapshot.outcomeFloorSequence
    this.nextSequenceValue = snapshot.nextOutcomeSequence
    this.restoreSemanticProducers(snapshot.semanticProducers, namespace)
    for (const outcome of snapshot.materializedOutcomes ?? []) {
      validateRestoredOutcome(outcome, namespace, revision)
      if (outcome.sequence >= snapshot.nextOutcomeSequence) {
        failTerminalSessionAuthority(
          'record-corrupt',
          'materialized outcome exceeds the journal high-water mark'
        )
      }
    }
    this.materialized.restore(snapshot.materializedOutcomes ?? [])
    let expectedSequence = this.floorSequenceValue + 1
    for (const outcome of snapshot.outcomes) {
      if (outcome.sequence !== expectedSequence) {
        failTerminalSessionAuthority('record-corrupt', 'outcome snapshot contains a journal gap')
      }
      validateRestoredOutcome(outcome, namespace, revision)
      this.registerOutcome(Object.freeze(outcome))
      expectedSequence += 1
    }
    if (expectedSequence !== this.nextSequenceValue) {
      failTerminalSessionAuthority('record-corrupt', 'outcome snapshot tail is inconsistent')
    }
  }

  private restoreSemanticProducers(
    snapshots: readonly TerminalAuthoritySemanticProducerSnapshot[],
    namespace: TerminalAuthorityNamespace
  ): void {
    for (const snapshot of snapshots) {
      assertSemanticProducerSnapshotShape(snapshot, namespace)
      const key = semanticProducerKey(snapshot.access, snapshot.producerIncarnationId)
      if (
        this.semanticProducers.has(key) ||
        this.semanticProducers.size >= this.maxSemanticProducers
      ) {
        failTerminalSessionAuthority('record-corrupt', 'semantic producer cursor is inconsistent')
      }
      this.semanticProducers.set(key, structuredClone(snapshot))
    }
  }

  private registerOutcome(outcome: TerminalAuthorityDurableOutcome): void {
    const operation = mutationOperationKey(outcome)
    const semanticOperation = semanticOutcomeOperationKey(outcome)
    if (
      this.outcomes.has(outcome.sequence) ||
      this.outcomesById.has(outcome.outcomeId) ||
      (operation !== null && this.operations.has(operation)) ||
      (semanticOperation !== null && this.semanticOperations.has(semanticOperation))
    ) {
      failTerminalSessionAuthority('record-corrupt', 'outcome identity is duplicated')
    }
    this.outcomes.set(outcome.sequence, outcome)
    this.outcomesById.set(outcome.outcomeId, outcome)
    if (outcome.kind === 'semantic') {
      this.semanticOperations.set(semanticOperation!, outcome)
    } else {
      this.operations.set(operation!, outcome)
    }
    this.retainedBytes += outcome.byteLength
  }

  private removeOutcome(outcome: TerminalAuthorityDurableOutcome): void {
    this.outcomes.delete(outcome.sequence)
    this.outcomesById.delete(outcome.outcomeId)
    const semanticOperation = semanticOutcomeOperationKey(outcome)
    if (semanticOperation !== null) {
      this.semanticOperations.delete(semanticOperation)
    } else {
      this.operations.delete(mutationOperationKey(outcome)!)
    }
    this.retainedBytes -= outcome.byteLength
  }
}
