import {
  assertAuthorityId,
  assertAuthorityNamespace,
  type TerminalAuthorityNamespace,
  type TerminalPaneGeneration,
  type TerminalSessionBinding
} from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalAuthorityConsumerProjection,
  type TerminalAuthorityOutcome,
  type TerminalAuthorityOutcomeRead,
  type TerminalAuthorityProjection,
  type TerminalAuthoritySemanticOutcome,
  type TerminalBindingAuthority,
  type TerminalPaneAuthorityRecord,
  type TerminalSessionAuthorityLegacyMigration,
  type TerminalSessionAuthorityLogEvent,
  type TerminalSessionAuthorityMutationRequest,
  type TerminalSessionAuthoritySemanticOutcomeRequest,
  type TerminalSessionAuthoritySnapshot,
  type TerminalSessionPtyAllocation,
  type TerminalSessionPtyAllocationIdentity
} from './terminal-session-authority-mutation'
import { TerminalSessionAuthorityOutcomeJournal } from './terminal-session-authority-outcome-journal'
import {
  assertMutationRequest,
  assertSafeInteger
} from './terminal-session-authority-record-validation'
import { TerminalSessionAuthorityTopology } from './terminal-session-authority-topology'
import { deriveTerminalAuthorityOutcome } from './terminal-session-authority-transition'
import { TerminalSessionAuthorityLegacyState } from './terminal-session-authority-legacy-state'
import { planTerminalAuthoritySemanticOutcome } from './terminal-session-authority-semantic-outcome'
import { assertTerminalAuthorityMaterializedOutcomesMatchTopology } from './terminal-session-authority-materialized-outcomes'
import { assertTerminalSessionAuthoritySnapshotEnvelope } from './terminal-session-authority-snapshot'
import {
  terminalAuthorityConsumerClaimProjection,
  terminalAuthorityConsumerProjection,
  terminalAuthorityStateSnapshot
} from './terminal-session-authority-state-projections'
import { applyTerminalAuthorityStateEvent } from './terminal-session-authority-state-event-application'
import {
  resolveTerminalAuthorityStateLimits,
  type TerminalSessionAuthorityStateOptions
} from './terminal-session-authority-state-limits'

export type { TerminalSessionAuthorityStateOptions } from './terminal-session-authority-state-limits'

export class TerminalSessionAuthorityState {
  readonly namespace: TerminalAuthorityNamespace
  private readonly topology: TerminalSessionAuthorityTopology
  private readonly outcomes: TerminalSessionAuthorityOutcomeJournal
  readonly legacy: TerminalSessionAuthorityLegacyState
  private revisionValue = 0
  private writerEpochValue: number

  constructor(
    namespace: TerminalAuthorityNamespace,
    writerEpoch: number,
    readonly ownerIncarnationId: string,
    options: TerminalSessionAuthorityStateOptions = {}
  ) {
    assertAuthorityNamespace(namespace)
    this.namespace = Object.freeze({ ...namespace })
    assertAuthorityId(ownerIncarnationId, 'ownerIncarnationId')
    assertSafeInteger(writerEpoch, 'writer epoch', 1)
    this.writerEpochValue = writerEpoch
    const limits = resolveTerminalAuthorityStateLimits(options)
    this.legacy = new TerminalSessionAuthorityLegacyState(this.namespace, ownerIncarnationId, {
      migrations: limits.legacyMigrations,
      workers: limits.legacyWorkers,
      recoveries: limits.legacyRecoveryRows
    })
    this.topology = new TerminalSessionAuthorityTopology(
      ownerIncarnationId,
      limits.pendingAllocations,
      limits.paneRecords,
      (candidate) => this.legacy.ownerIsReachable(candidate)
    )
    this.outcomes = new TerminalSessionAuthorityOutcomeJournal(
      limits.consumers,
      limits.retainedOperationEntries,
      limits.retainedOperationBytes,
      limits.paneRecords
    )
  }

  static restore(
    snapshot: TerminalSessionAuthoritySnapshot,
    writerEpoch: number,
    ownerIncarnationId: string,
    options: TerminalSessionAuthorityStateOptions = {}
  ): TerminalSessionAuthorityState {
    assertTerminalSessionAuthoritySnapshotEnvelope(snapshot)
    const state = new TerminalSessionAuthorityState(
      snapshot.namespace,
      writerEpoch,
      ownerIncarnationId,
      options
    )
    state.revisionValue = snapshot.revision
    state.topology.restore(snapshot.panes, snapshot.allocations, snapshot.revision)
    state.legacy.restore(snapshot.legacyMigrations, state.topology)
    state.outcomes.restore(snapshot, state.namespace, snapshot.revision)
    assertTerminalAuthorityMaterializedOutcomesMatchTopology(
      state.outcomes.materializedProjection(),
      (generation) => state.topology.pane(generation)
    )
    return state
  }

  get revision(): number {
    return this.revisionValue
  }

  get writerEpoch(): number {
    return this.writerEpochValue
  }

  setWriterEpoch(epoch: number): void {
    assertSafeInteger(epoch, 'writer epoch', this.writerEpochValue)
    this.writerEpochValue = epoch
  }

  pane(generation: TerminalPaneGeneration): TerminalPaneAuthorityRecord | null {
    return this.topology.pane(generation)
  }

  openPaneGenerationId(paneKey: string): string | null {
    return this.topology.openPaneGenerationId(paneKey)
  }

  latestPaneGenerationId(paneKey: string): string | null {
    return this.topology.latestPaneGenerationId(paneKey)
  }

  get paneCapacityReached(): boolean {
    return this.topology.paneCapacityReached
  }

  allocation(allocationId: string): TerminalSessionPtyAllocation | null {
    return this.topology.allocation(allocationId)
  }

  paneAllocation(pane: TerminalPaneGeneration): TerminalSessionPtyAllocation | null {
    return this.topology.paneAllocation(pane)
  }

  allocationConflict(allocation: TerminalSessionPtyAllocationIdentity): boolean {
    return this.topology.allocationConflict(allocation)
  }

  ptyOwner(binding: TerminalSessionBinding): string | null {
    return this.topology.ptyOwner(binding)
  }

  ownerIsReachable(ownerIncarnationId: string): boolean {
    return this.legacy.ownerIsReachable(ownerIncarnationId)
  }

  get hasConsumers(): boolean {
    return this.outcomes.hasConsumers
  }

  setLegacyOwnerReachable(ownerIncarnationId: string, reachable: boolean): boolean {
    const affectsProjection = this.topology.ownerHasBinding(ownerIncarnationId)
    return this.legacy.setOwnerReachable(ownerIncarnationId, reachable) && affectsProjection
  }

  assertLegacyMigrationTopologyAllowed(migration: TerminalSessionAuthorityLegacyMigration): void {
    this.legacy.assertTopologyAllowed(migration, this.topology, 'operation-conflict')
  }

  planConsumerClaim(
    consumerId: string,
    expectedIncarnationId: string | null,
    consumerIncarnationId: string
  ): TerminalSessionAuthorityLogEvent | null {
    return this.outcomes.planClaim(consumerId, expectedIncarnationId, consumerIncarnationId)
  }

  planMutation(
    request: TerminalSessionAuthorityMutationRequest,
    replayPersistedEvent = false
  ): {
    outcome: TerminalAuthorityOutcome
    duplicate: boolean
  } {
    assertMutationRequest(request)
    const existing = this.outcomes.findMutation(request, this.revisionValue)
    if (existing) {
      return { outcome: existing, duplicate: true }
    }
    this.legacy.assertMutationAllowed(request)
    if (
      request.change.kind === 'prepare-allocation' &&
      (this.topology.hasIntent(request.actorId, request.operationId) ||
        this.topology.pendingAllocationCapacityReached)
    ) {
      failTerminalSessionAuthority('allocation-conflict', 'allocation intent cannot be reserved')
    }
    if (
      request.change.kind === 'create' &&
      this.topology.latestPaneGenerationId(request.change.pane.paneKey) === null &&
      this.topology.paneCapacityReached
    ) {
      failTerminalSessionAuthority('capacity', 'terminal authority panes are full')
    }
    const outcome = deriveTerminalAuthorityOutcome(
      this,
      request,
      this.outcomes.nextSequence(request.outcomeId),
      replayPersistedEvent
    )
    this.outcomes.assertCanAppend(outcome)
    return { outcome, duplicate: false }
  }

  planSemanticOutcome(request: TerminalSessionAuthoritySemanticOutcomeRequest): {
    outcome: TerminalAuthoritySemanticOutcome
    duplicate: boolean
  } {
    return planTerminalAuthoritySemanticOutcome(this, this.outcomes, request)
  }

  planOutcomeAck(
    consumerId: string,
    consumerIncarnationId: string,
    sequence: number
  ): TerminalSessionAuthorityLogEvent | null {
    return this.outcomes.planAck(consumerId, consumerIncarnationId, sequence)
  }

  planConsumerRetirement(
    consumerId: string,
    consumerIncarnationId: string
  ): TerminalSessionAuthorityLogEvent | null {
    return this.outcomes.planRetire(consumerId, consumerIncarnationId)
  }

  applyEvent(event: TerminalSessionAuthorityLogEvent): void {
    applyTerminalAuthorityStateEvent({
      event,
      revision: this.revisionValue,
      setRevision: (revision) => {
        this.revisionValue = revision
      },
      legacy: this.legacy,
      topology: this.topology,
      outcomes: this.outcomes,
      view: this,
      planMutation: (request, replayPersistedEvent) =>
        this.planMutation(request, replayPersistedEvent)
    })
  }

  readOutcomes(
    consumerId: string,
    consumerIncarnationId: string,
    afterSequence: number,
    limit = 100
  ): TerminalAuthorityOutcomeRead {
    return this.outcomes.read(consumerId, consumerIncarnationId, afterSequence, limit)
  }

  activeConsumerIncarnation(consumerId: string): string | null {
    return this.outcomes.activeIncarnation(consumerId)
  }

  snapshotForConsumer(
    consumerId: string,
    consumerIncarnationId: string
  ): TerminalAuthorityConsumerProjection {
    return terminalAuthorityConsumerProjection(
      this.projection(),
      this.outcomes,
      consumerId,
      consumerIncarnationId
    )
  }

  snapshotForConsumerClaim(
    consumerId: string,
    expectedIncarnationId: string | null,
    consumerIncarnationId: string
  ): TerminalAuthorityConsumerProjection {
    return terminalAuthorityConsumerClaimProjection(
      this.projection(),
      this.outcomes,
      consumerId,
      expectedIncarnationId,
      consumerIncarnationId
    )
  }

  projection(): TerminalAuthorityProjection {
    return Object.freeze({
      namespace: this.namespace,
      writerEpoch: this.writerEpochValue,
      revision: this.revisionValue,
      panes: this.topology.projectedPanes(),
      allocations: this.topology.allocationSnapshot(),
      materializedOutcomes: this.outcomes.materializedProjection()
    })
  }

  bindingAuthority(
    pane: TerminalPaneGeneration,
    binding: TerminalSessionBinding
  ): TerminalBindingAuthority {
    return this.topology.bindingAuthority(pane, binding)
  }

  snapshot(): TerminalSessionAuthoritySnapshot {
    return terminalAuthorityStateSnapshot({
      namespace: this.namespace,
      writerEpoch: this.writerEpochValue,
      revision: this.revisionValue,
      topology: this.topology,
      outcomes: this.outcomes,
      legacy: this.legacy
    })
  }
}
