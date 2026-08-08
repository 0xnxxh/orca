import type { TerminalLegacyWorkspaceEvidence } from '../../shared/terminal-legacy-cutover'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { TerminalAuthorityPathFlavor } from '../../shared/terminal-session-authority-locator'
import type { FolderWorkspace, WorkspaceSessionState } from '../../shared/types'
import type { SshPtyConsumerRecovery, SshRemotePtyLease } from '../../shared/ssh-types'
import type {
  SshLegacyMigrationInventoryInput,
  SshLegacyRelayIdentityProof,
  SshLegacySerializedPtyEvidence
} from './ssh-legacy-migration-inventory-types'

export type SshLegacyWorkspaceReference =
  | Readonly<{
      kind: 'git-worktree'
      clientWorkspaceId: string
      path: string
    }>
  | Readonly<{
      kind: 'folder-workspace'
      clientWorkspaceId: string
      path: string
    }>
  | Readonly<{
      kind: 'floating'
      clientWorkspaceId: string
      path: string | null
    }>
  | Readonly<{
      kind: 'workspace-path'
      path: string
    }>

export type SshLegacyUnresolvedPaneEvidence = Readonly<{
  targetId: string
  partitionId: string
  ptyId: string
  paneKey: string
  tabId: string
  leafId: string
  rendererGeneration: number | null
  workspaceReference: SshLegacyWorkspaceReference
}>

export type SshLegacyPersistedWorkspacePartition = Readonly<{
  targetId: string
  partitionId: string
  session: Readonly<Pick<WorkspaceSessionState, 'tabsByWorktree' | 'terminalLayoutsByTabId'>>
  folderWorkspaces: readonly Readonly<Pick<FolderWorkspace, 'id' | 'folderPath'>>[]
  floatingWorkspacePath?: string | null
}>

export type SshLegacyWorkerRecoveryAssociation = Readonly<{
  targetId: string
  endpointId: string
  workerId: string
  buildId: string
  recovery: Readonly<SshPtyConsumerRecovery>
}>

export type SshLegacyLocalMigrationEvidence = Readonly<{
  panes: readonly SshLegacyUnresolvedPaneEvidence[]
  leases: readonly Readonly<SshRemotePtyLease>[]
  workerRecoveries: readonly SshLegacyWorkerRecoveryAssociation[]
}>

export type SshLegacyDiscoveredRelayInventoryRow = Readonly<{
  physicalPtyId: string
  ptyIncarnationId: string | null
  processId: number | null
  workspaceReference: SshLegacyWorkspaceReference
  serialized: SshLegacySerializedPtyEvidence
}>

export type SshLegacyDiscoveredRelayEvidence = Readonly<{
  targetId: string
  endpointId: string
  workerId: string
  buildId: string
  observedAtMs: number
  identityProof: SshLegacyRelayIdentityProof
  rows: readonly SshLegacyDiscoveredRelayInventoryRow[]
}>

export type SshLegacyWorkspaceResolutionRequest = Readonly<{
  targetId: string
  authorityHostId: string
  hostPathFlavor: TerminalAuthorityPathFlavor
  source: 'local-layout' | 'remote-snapshot' | 'relay-inventory'
  partitionId: string | null
  endpointId: string | null
  reference: SshLegacyWorkspaceReference
}>

export type SshLegacyWorkspaceResolution = Readonly<{
  namespace: TerminalAuthorityNamespace
  workspace: TerminalLegacyWorkspaceEvidence
}>

export type SshLegacyWorkspaceResolver = (
  request: SshLegacyWorkspaceResolutionRequest
) => SshLegacyWorkspaceResolution | Promise<SshLegacyWorkspaceResolution>

export type SshLegacyMigrationEvidenceBridgeInput = Readonly<{
  targetId: string
  authorityHostId: string
  hostPathFlavor: TerminalAuthorityPathFlavor
  persistedWorkspacePartitions: readonly SshLegacyPersistedWorkspacePartition[]
  persistedPtyLeases: readonly Readonly<SshRemotePtyLease>[]
  workerRecoveries: readonly SshLegacyWorkerRecoveryAssociation[]
  remoteSnapshotPanes: readonly SshLegacyUnresolvedPaneEvidence[]
  discoveredRelays: readonly SshLegacyDiscoveredRelayEvidence[]
  resolveWorkspace: SshLegacyWorkspaceResolver
}>

export type SshLegacyMigrationEvidenceBridgeResult = SshLegacyMigrationInventoryInput
