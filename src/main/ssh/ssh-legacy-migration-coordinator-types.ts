import type { TerminalLegacyMigrationReceipt } from '../../shared/terminal-legacy-cutover'
import type { TerminalAuthorityPathFlavor } from '../../shared/terminal-session-authority-locator'
import type { LegacyPhysicalWorkerDescriptor } from '../../relay/legacy-physical-worker-control-protocol'
import type { LegacyPhysicalWorkerPty } from '../../relay/legacy-physical-worker-inventory'
import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import type {
  SshLegacyMigrationInventoryInput,
  SshLegacyMigrationInventorySummary,
  SshLegacyRelayIdentityProof,
  SshLegacySerializedPtyEvidence
} from './ssh-legacy-migration-inventory-types'

export type SshLegacyPreparedPhysicalPty = LegacyPhysicalWorkerPty &
  Readonly<{ serialized: SshLegacySerializedPtyEvidence }>

export type SshLegacyPhysicalWorkerInspection = Readonly<{
  protocolVersion: 1
  workerId: string
  routeId: string
  buildId: string
  preparation: Readonly<{
    mode: 'observational'
    token: string
    evidenceDigest: string
    catalogValidation: 'before-isolation'
    replay: 'durable-operation-id'
  }>
  identityProof: SshLegacyRelayIdentityProof
  ptys: readonly SshLegacyPreparedPhysicalPty[]
}>

export type SshLegacyInspectedWorker = Readonly<{
  descriptor: LegacyPhysicalWorkerDescriptor
  inspection: SshLegacyPhysicalWorkerInspection
}>

export type SshLegacyEvidenceUnavailable = Readonly<{
  kind: 'unresolved'
  reason: string
}>

export type SshLegacyWorkerDiscovery =
  | Readonly<{
      kind: 'ready'
      workers: readonly LegacyPhysicalWorkerDescriptor[]
    }>
  | SshLegacyEvidenceUnavailable

export type SshLegacyInventoryEvidence =
  | Readonly<{
      kind: 'ready'
      inventory: SshLegacyMigrationInventoryInput
    }>
  | SshLegacyEvidenceUnavailable

export type SshLegacyMigrationEvidenceProvider = Readonly<{
  discoverWorkers: (input: {
    targetId: string
    authorityHostId: string
    hostPathFlavor: TerminalAuthorityPathFlavor
    attemptId: string
    signal: AbortSignal
  }) => Promise<SshLegacyWorkerDiscovery>
  buildInventory: (input: {
    targetId: string
    authorityHostId: string
    hostPathFlavor: TerminalAuthorityPathFlavor
    attemptId: string
    signal: AbortSignal
    workers: readonly SshLegacyInspectedWorker[]
  }) => Promise<SshLegacyInventoryEvidence>
}>

export type SshLegacyMigrationRpc = Pick<SshChannelMultiplexer, 'request'>

export type SshLegacyMigrationCoordinatorInput = Readonly<{
  targetId: string
  authorityHostId: string
  hostPathFlavor: TerminalAuthorityPathFlavor
  authorityCapabilities: readonly string[] | undefined
  attemptId: string
  signal: AbortSignal
  isAttemptCurrent: () => boolean
  rpc: SshLegacyMigrationRpc
  evidenceProvider?: SshLegacyMigrationEvidenceProvider
}>

export type SshLegacyMigrationUnresolvedPhase =
  | 'worker-discovery'
  | 'inspection'
  | 'evidence'
  | 'planning'
  | 'catalog-commit'
  | 'barrier'

export type SshLegacyMigrationOutcome =
  | Readonly<{
      kind: 'read-only'
      reason: 'capability-not-negotiated'
    }>
  | Readonly<{
      kind: 'unresolved'
      phase: SshLegacyMigrationUnresolvedPhase
      reason: string
      mutationState:
        | 'none'
        | 'catalog-partially-committed'
        | 'catalog-committed'
        | 'commit-uncertain'
      workerId?: string
    }>
  | Readonly<{
      kind: 'committed'
      summary: SshLegacyMigrationInventorySummary
      receipts: readonly Readonly<
        Pick<TerminalLegacyMigrationReceipt, 'receiptId' | 'sequence'> & {
          workerId: string
          duplicate: boolean
        }
      >[]
      barrierId: string
      catalogRevision: number
      gc:
        | Readonly<{ kind: 'completed'; removed: readonly string[] }>
        | Readonly<{ kind: 'pending'; reason: string }>
    }>

export type { LegacyPhysicalWorkerDescriptor }
