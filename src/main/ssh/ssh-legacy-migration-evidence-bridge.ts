import { assertAuthorityId } from '../../shared/terminal-session-authority-identity'
import {
  resolveSshLegacyPanes,
  resolveSshLegacyRelays
} from './ssh-legacy-migration-authority-resolution'
import {
  collectSshLegacyWorkerRecoveries,
  indexSshLegacyDiscoveredRelays
} from './ssh-legacy-migration-consumer-association'
import {
  SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY,
  assertSshLegacyArrayCapacity,
  failSshLegacyMigrationEvidence
} from './ssh-legacy-migration-evidence-capacity'
import type {
  SshLegacyMigrationEvidenceBridgeInput,
  SshLegacyMigrationEvidenceBridgeResult
} from './ssh-legacy-migration-evidence-bridge-types'
import {
  projectSshLegacyConsumerEvidence,
  projectSshLegacyLeaseEvidence,
  projectSshLegacyPaneEvidence,
  projectSshLegacyRelayEvidence,
  sortSshLegacyEvidence
} from './ssh-legacy-migration-evidence-projection'
import { assertSshLegacyMigrationInventoryCapacity } from './ssh-legacy-migration-inventory-capacity'
import { assertSshLegacyMigrationInventoryInput } from './ssh-legacy-migration-inventory-validation'
import { normalizeSshLegacyPtyLeases } from './ssh-legacy-migration-lease-normalization'
import { collectSshLegacyLocalMigrationEvidence } from './ssh-legacy-migration-local-evidence'

export async function buildSshLegacyMigrationInventoryInput(
  input: SshLegacyMigrationEvidenceBridgeInput
): Promise<SshLegacyMigrationEvidenceBridgeResult> {
  assertBridgeIdentity(input)
  preflightBridgeCapacity(input)
  const local = collectSshLegacyLocalMigrationEvidence(input)
  const relays = input.discoveredRelays.filter((relay) => relay.targetId === input.targetId)
  const relayByAssociation = indexSshLegacyDiscoveredRelays(relays)
  const persistedConsumerRecoveries = collectSshLegacyWorkerRecoveries(
    input.targetId,
    local.workerRecoveries,
    relayByAssociation
  )
  const localPanes = await resolveSshLegacyPanes(input, local.panes, 'local-layout')
  const remotePanes = await resolveSshLegacyPanes(
    input,
    input.remoteSnapshotPanes.filter((pane) => pane.targetId === input.targetId),
    'remote-snapshot'
  )
  const liveRelays = await resolveSshLegacyRelays(input, relays)
  const result = Object.freeze({
    targetId: input.targetId,
    authorityHostId: input.authorityHostId,
    hostPathFlavor: input.hostPathFlavor,
    persistedConsumerRecoveries: Object.freeze(
      sortSshLegacyEvidence(persistedConsumerRecoveries, projectSshLegacyConsumerEvidence)
    ),
    persistedPtyLeases: Object.freeze(
      sortSshLegacyEvidence(
        normalizeSshLegacyPtyLeases(input.targetId, local.leases, localPanes),
        projectSshLegacyLeaseEvidence
      )
    ),
    localLayoutPanes: Object.freeze(
      sortSshLegacyEvidence(
        localPanes.map((entry) => entry.pane),
        projectSshLegacyPaneEvidence
      )
    ),
    remoteSnapshotPanes: Object.freeze(
      sortSshLegacyEvidence(
        remotePanes.map((entry) => entry.pane),
        projectSshLegacyPaneEvidence
      )
    ),
    liveRelays: Object.freeze(
      sortSshLegacyEvidence(liveRelays, (relay) => projectSshLegacyRelayEvidence(relay, true))
    )
  })
  assertSshLegacyMigrationInventoryCapacity(result)
  assertSshLegacyMigrationInventoryInput(result)
  return result
}

function preflightBridgeCapacity(input: SshLegacyMigrationEvidenceBridgeInput): void {
  assertSshLegacyArrayCapacity(
    input.persistedWorkspacePartitions,
    SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.workspacePartitions,
    'workspace partitions'
  )
  assertSshLegacyArrayCapacity(
    input.persistedPtyLeases,
    SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.persistedPtyLeases,
    'persisted PTY leases'
  )
  assertSshLegacyArrayCapacity(
    input.workerRecoveries,
    SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.workerRecoveries,
    'worker recovery associations'
  )
  assertSshLegacyArrayCapacity(
    input.remoteSnapshotPanes,
    SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.totalRemotePanes,
    'remote snapshot panes'
  )
  assertSshLegacyArrayCapacity(
    input.discoveredRelays,
    SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.discoveredRelays,
    'discovered relays'
  )
  let totalRows = 0
  for (const relay of input.discoveredRelays) {
    assertSshLegacyArrayCapacity(
      relay.rows,
      SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.rowsPerRelay,
      'discovered relay rows'
    )
    totalRows += relay.rows.length
    if (totalRows > SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.totalRelayRows) {
      failSshLegacyMigrationEvidence('capacity', 'total discovered relay rows')
    }
  }
}

function assertBridgeIdentity(input: SshLegacyMigrationEvidenceBridgeInput): void {
  assertAuthorityId(input.targetId, 'SSH legacy bridge targetId')
  assertAuthorityId(input.authorityHostId, 'SSH legacy bridge authorityHostId')
  if (input.hostPathFlavor !== 'posix' && input.hostPathFlavor !== 'windows') {
    failSshLegacyMigrationEvidence('malformed', 'authority host path flavor')
  }
}

export type {
  SshLegacyDiscoveredRelayEvidence,
  SshLegacyDiscoveredRelayInventoryRow,
  SshLegacyLocalMigrationEvidence,
  SshLegacyMigrationEvidenceBridgeInput,
  SshLegacyMigrationEvidenceBridgeResult,
  SshLegacyPersistedWorkspacePartition,
  SshLegacyUnresolvedPaneEvidence,
  SshLegacyWorkerRecoveryAssociation,
  SshLegacyWorkspaceReference,
  SshLegacyWorkspaceResolution,
  SshLegacyWorkspaceResolutionRequest,
  SshLegacyWorkspaceResolver
} from './ssh-legacy-migration-evidence-bridge-types'
export { collectSshLegacyLocalMigrationEvidence } from './ssh-legacy-migration-local-evidence'
export { parseSshLegacyRemoteWorkspaceSnapshotEvidence } from './ssh-legacy-migration-remote-workspace-snapshot'
export {
  SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY,
  SshLegacyMigrationEvidenceError
} from './ssh-legacy-migration-evidence-capacity'
