import type {
  TerminalLegacyEndpointIdentity,
  TerminalLegacyImportCandidate,
  TerminalLegacyProcessIdentity,
  TerminalLegacyRecoveryReason,
  TerminalLegacyUnresolvedCandidate,
  TerminalLegacyWorkspaceEvidence
} from '../../shared/terminal-legacy-cutover'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { TerminalAuthorityPathFlavor } from '../../shared/terminal-session-authority-locator'
import type { SshPtyConsumerRecovery, SshRemotePtyLease } from '../../shared/ssh-types'

export type SshLegacyPersistedConsumerEvidence = Readonly<
  Pick<SshPtyConsumerRecovery, 'targetId' | 'clientInstanceId' | 'serverBuildId'> & {
    workerId: string
  }
>

export type SshLegacyLayoutPaneEvidence = Readonly<{
  targetId: string
  partitionId: string
  ptyId: string
  paneKey: string | null
  tabId: string | null
  leafId: string | null
  rendererGeneration: number | null
  namespace: TerminalAuthorityNamespace
  workspace: TerminalLegacyWorkspaceEvidence
}>

export type SshLegacyRemoteSnapshotPaneEvidence = SshLegacyLayoutPaneEvidence

export type SshLegacyRelayIdentityProof = Readonly<{
  expectedEndpoint: TerminalLegacyEndpointIdentity | null
  observedEndpoint: TerminalLegacyEndpointIdentity | null
  expectedProcess: TerminalLegacyProcessIdentity | null
  observedProcess: TerminalLegacyProcessIdentity | null
}>

export type SshLegacySerializedPtyEvidence = Readonly<{
  paneKey: string | null
  tabId: string | null
  worktreeId: string | null
  cwd: string | null
  ptyIncarnationId: string | null
  processId: number | null
}>

export type SshLegacyRelayInventoryRow = Readonly<{
  workerId: string
  buildId: string
  physicalPtyId: string
  ptyIncarnationId: string | null
  processId: number | null
  namespace: TerminalAuthorityNamespace
  workspace: TerminalLegacyWorkspaceEvidence
  serialized: SshLegacySerializedPtyEvidence
}>

export type SshLegacyLiveRelayInventory = Readonly<{
  workerId: string
  buildId: string
  observedAtMs: number
  identityProof: SshLegacyRelayIdentityProof
  rows: readonly SshLegacyRelayInventoryRow[]
}>

export type SshLegacyMigrationInventoryInput = Readonly<{
  targetId: string
  authorityHostId: string
  hostPathFlavor: TerminalAuthorityPathFlavor
  persistedConsumerRecoveries: readonly SshLegacyPersistedConsumerEvidence[]
  persistedPtyLeases: readonly SshRemotePtyLease[]
  localLayoutPanes: readonly SshLegacyLayoutPaneEvidence[]
  remoteSnapshotPanes: readonly SshLegacyRemoteSnapshotPaneEvidence[]
  liveRelays: readonly SshLegacyLiveRelayInventory[]
}>

export type SshLegacyMigrationInventorySummary = Readonly<{
  evidenceDigest: string
  migrationId: string
  relayCount: number
  inventoryRowCount: number
  importCount: number
  unresolvedCount: number
  unresolvedReasons: readonly Readonly<{
    reason: TerminalLegacyRecoveryReason
    count: number
  }>[]
}>

export type SshLegacyMigrationInventoryPlan = Readonly<{
  evidenceDigest: string
  migrationId: string
  imports: readonly TerminalLegacyImportCandidate[]
  unresolved: readonly TerminalLegacyUnresolvedCandidate[]
  summary: SshLegacyMigrationInventorySummary
}>
