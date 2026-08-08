import type {
  TerminalAuthorityNamespace,
  TerminalPaneGeneration,
  TerminalSessionBinding
} from './terminal-session-authority-identity'
import type { TerminalLegacyMigrationReceipt } from './terminal-legacy-cutover'
import type { TerminalSessionAuthorityPtyAccess } from './terminal-session-authority-pty-access'
import type { TerminalSideEffectFact } from './terminal-side-effect-facts'

export type TerminalPaneAuthorityStatus = 'open' | 'closed' | 'superseded' | 'exited'

export type TerminalPaneAuthorityRecord = Readonly<{
  paneKey: string
  paneGenerationId: string
  status: TerminalPaneAuthorityStatus
  binding: TerminalSessionBinding | null
  lastBinding: TerminalSessionBinding | null
  revision: number
}>

export type TerminalSessionPtyAllocationIdentity = Readonly<{
  allocationId: string
  pane: TerminalPaneGeneration
  ownerIncarnationId: string
  physicalPtyId: string
  spawnFingerprint: string
}>

export type TerminalSessionPtyAllocation = TerminalSessionPtyAllocationIdentity &
  Readonly<{
    intentActorId: string
    intentOperationId: string
    preparedAtRevision: number
  }> &
  (
    | Readonly<{ status: 'pending'; binding: null }>
    | Readonly<{
        status: 'committed'
        binding: TerminalSessionBinding
        committedAtRevision: number
      }>
  )

export type TerminalSessionExpectation = Readonly<{
  paneGenerationId: string
  binding: TerminalSessionBinding | null
}>

export type TerminalSessionAuthorityChange =
  | Readonly<{ kind: 'create'; pane: TerminalPaneGeneration }>
  | Readonly<{
      kind: 'prepare-allocation'
      allocation: TerminalSessionPtyAllocationIdentity
      expected: TerminalSessionExpectation
    }>
  | Readonly<{
      kind: 'commit-allocation'
      allocation: TerminalSessionPtyAllocationIdentity
      ptyIncarnationId: string
      expected: TerminalSessionExpectation
    }>
  | Readonly<{
      kind: 'cancel-allocation'
      allocation: TerminalSessionPtyAllocationIdentity
      expected: TerminalSessionExpectation
    }>
  | Readonly<{
      kind: 'close'
      pane: TerminalPaneGeneration
      expected: TerminalSessionExpectation
    }>
  | Readonly<{
      kind: 'supersede'
      pane: TerminalPaneGeneration
      replacementPaneGenerationId: string
      expected: TerminalSessionExpectation
    }>
  | Readonly<{
      kind: 'exit'
      pane: TerminalPaneGeneration
      expected: TerminalSessionExpectation
      exit: Readonly<{
        code: number | null
        signal: string | null
        retiredByClose?: true
      }>
    }>

export type TerminalSessionAuthorityMutationRequest = Readonly<{
  actorId: string
  operationId: string
  baseRevision: number
  outcomeId: string
  change: TerminalSessionAuthorityChange
}>

export type TerminalSessionAuthorityEffect =
  | Readonly<{
      kind: 'binding-retired'
      reason: 'close' | 'supersede' | 'exit'
      binding: TerminalSessionBinding
    }>
  | Readonly<{
      kind: 'terminal-exited'
      binding: TerminalSessionBinding
      code: number | null
      signal: string | null
    }>

export type TerminalSessionAuthorityMutationResult = Readonly<{
  namespace: TerminalAuthorityNamespace
  actorId: string
  operationId: string
  kind: TerminalSessionAuthorityChange['kind']
  revision: number
  pane: TerminalPaneAuthorityRecord
  replacementPane: TerminalPaneAuthorityRecord | null
  allocation: TerminalSessionPtyAllocation | null
  effects: readonly TerminalSessionAuthorityEffect[]
}>

/** Terminal exit is a topology mutation, never a duplicated semantic fact. */
export type TerminalSessionAuthoritySemanticFact = TerminalSideEffectFact

export type TerminalSessionAuthoritySemanticOutcomeRequest = Readonly<{
  access: TerminalSessionAuthorityPtyAccess
  producerIncarnationId: string
  producerSequence: number
  fact: TerminalSessionAuthoritySemanticFact
}>

type TerminalAuthorityOutcomeEnvelope = Readonly<{
  sequence: number
  outcomeId: string
  byteLength: number
}>

/** Unchanged on the wire: `kind` is absent so pre-existing records stay byte-identical. */
export type TerminalAuthorityOutcome = TerminalAuthorityOutcomeEnvelope &
  Readonly<{
    kind?: undefined
    request: TerminalSessionAuthorityMutationRequest
    result: TerminalSessionAuthorityMutationResult
  }>

export type TerminalAuthoritySemanticOutcome = TerminalAuthorityOutcomeEnvelope &
  Readonly<{
    kind: 'semantic'
    access: TerminalSessionAuthorityPtyAccess
    producerIncarnationId: string
    producerSequence: number
    fact: TerminalSessionAuthoritySemanticFact
    appendedAtRevision: number
  }>

export type TerminalAuthorityDurableOutcome =
  | TerminalAuthorityOutcome
  | TerminalAuthoritySemanticOutcome

export type TerminalAuthorityConsumerSnapshot = Readonly<{
  consumerId: string
  activeIncarnationId: string
  acknowledgedSequence: number
}>

export type TerminalAuthoritySemanticProducerSnapshot = Readonly<{
  access: TerminalSessionAuthorityPtyAccess
  producerIncarnationId: string
  producerSequence: number
}>

export type TerminalSessionAuthorityLegacyMigration = Readonly<{
  version: 1
  namespace: TerminalAuthorityNamespace
  requestDigest: string
  authorityRevision: number
  receipt: TerminalLegacyMigrationReceipt
}>

export type TerminalSessionAuthoritySnapshot = Readonly<{
  version: 1
  namespace: TerminalAuthorityNamespace
  writerEpoch: number
  revision: number
  panes: readonly TerminalPaneAuthorityRecord[]
  allocations: readonly TerminalSessionPtyAllocation[]
  consumers: readonly TerminalAuthorityConsumerSnapshot[]
  outcomeFloorSequence: number
  nextOutcomeSequence: number
  outcomes: readonly TerminalAuthorityDurableOutcome[]
  semanticProducers: readonly TerminalAuthoritySemanticProducerSnapshot[]
  materializedOutcomes?: readonly TerminalAuthorityDurableOutcome[]
  legacyMigrations: readonly TerminalSessionAuthorityLegacyMigration[]
}>

export type TerminalSessionAuthorityLogEvent =
  | Readonly<{ kind: 'mutation'; outcome: TerminalAuthorityOutcome }>
  | Readonly<{ kind: 'semantic-outcome'; outcome: TerminalAuthoritySemanticOutcome }>
  | Readonly<{
      kind: 'legacy-migration'
      migration: TerminalSessionAuthorityLegacyMigration
    }>
  | Readonly<{
      kind: 'consumer-claim'
      consumerId: string
      expectedIncarnationId: string | null
      consumerIncarnationId: string
      acknowledgedSequence: number
    }>
  | Readonly<{
      kind: 'consumer-retire'
      consumerId: string
      consumerIncarnationId: string
    }>
  | Readonly<{
      kind: 'outcome-ack'
      consumerId: string
      consumerIncarnationId: string
      sequence: number
    }>

export type TerminalSessionAuthorityLogRecord = Readonly<{
  version: 1
  recordId: number
  writerEpoch: number
  event: TerminalSessionAuthorityLogEvent
}>

export type TerminalAuthorityOutcomeRead =
  | Readonly<{ kind: 'entries'; entries: readonly TerminalAuthorityDurableOutcome[] }>
  | Readonly<{
      kind: 'resnapshot-required'
      reason: 'cursor-compacted' | 'cursor-gap' | 'cursor-ahead'
      acknowledgedSequence: number
    }>

export type TerminalPaneAuthorityProjection = TerminalPaneAuthorityRecord &
  Readonly<{ ownerStatus: 'reachable' | 'owner-unreachable' | null }>

export type TerminalAuthorityProjection = Readonly<{
  namespace: TerminalAuthorityNamespace
  writerEpoch: number
  revision: number
  panes: readonly TerminalPaneAuthorityProjection[]
  allocations: readonly TerminalSessionPtyAllocation[]
  /** Optional only for restoring or parsing a peer predating authority outcome boundaries. */
  materializedOutcomes?: readonly TerminalAuthorityDurableOutcome[]
}>

export type TerminalAuthorityConsumerProjection = Readonly<{
  authority: TerminalAuthorityProjection
  acknowledgedSequence: number
  outcomeHighWatermark: number
}>

export type TerminalBindingAuthority =
  | 'absent'
  | 'binding-mismatch'
  | 'closed'
  | 'exited'
  | 'owner-unreachable'
  | 'reachable'

export type TerminalSessionAuthorityErrorCode =
  | 'allocation-conflict'
  | 'capacity'
  | 'consumer-conflict'
  | 'consumer-unknown'
  | 'expectation-mismatch'
  | 'operation-conflict'
  | 'record-corrupt'
  | 'revision-conflict'
  | 'writer-fenced'

export class TerminalSessionAuthorityError extends Error {
  readonly name = 'TerminalSessionAuthorityError'

  constructor(
    readonly code: TerminalSessionAuthorityErrorCode,
    message: string
  ) {
    super(message)
  }
}

export function failTerminalSessionAuthority(
  code: TerminalSessionAuthorityErrorCode,
  message: string
): never {
  throw new TerminalSessionAuthorityError(code, message)
}
