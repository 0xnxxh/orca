import {
  assertAuthorityId,
  assertAuthorityStoragePath,
  isRecord
} from '../../shared/terminal-session-authority-identity'
import type { SshRemotePtyLease } from '../../shared/ssh-types'
import { sshLegacyClientWorkspaceReference } from './ssh-legacy-migration-workspace-reference'
import {
  compareSshLegacyText,
  sshLegacyPhysicalPtyId
} from './ssh-legacy-migration-evidence-identity'
import { projectSshLegacyLeaseEvidence } from './ssh-legacy-migration-evidence-projection'
import {
  SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY,
  assertSshLegacyArrayCapacity,
  boundedSshLegacyRecordEntries,
  failSshLegacyMigrationEvidence
} from './ssh-legacy-migration-evidence-capacity'
import type {
  SshLegacyLocalMigrationEvidence,
  SshLegacyPersistedWorkspacePartition,
  SshLegacyUnresolvedPaneEvidence,
  SshLegacyWorkerRecoveryAssociation,
  SshLegacyWorkspaceReference
} from './ssh-legacy-migration-evidence-bridge-types'
import { collectSshLegacyLayoutBindings } from './ssh-legacy-migration-layout-evidence'

export function collectSshLegacyLocalMigrationEvidence(input: {
  targetId: string
  persistedWorkspacePartitions: readonly SshLegacyPersistedWorkspacePartition[]
  persistedPtyLeases: readonly Readonly<SshRemotePtyLease>[]
  workerRecoveries: readonly SshLegacyWorkerRecoveryAssociation[]
}): SshLegacyLocalMigrationEvidence {
  assertAuthorityId(input.targetId, 'SSH legacy evidence targetId')
  preflightLocalEvidenceCapacity(input)
  const leases = input.persistedPtyLeases.filter((lease) => lease.targetId === input.targetId)
  const physicalPtyIds = new Set(
    leases
      .map((lease) => sshLegacyPhysicalPtyId(input.targetId, lease.ptyId))
      .filter((ptyId): ptyId is string => ptyId !== null)
  )
  const panes: SshLegacyUnresolvedPaneEvidence[] = []
  for (const partition of input.persistedWorkspacePartitions) {
    validatePartitionIdentity(partition)
    if (partition.targetId !== input.targetId) {
      continue
    }
    collectPartitionPanes(input.targetId, partition, physicalPtyIds, panes)
  }
  const workerRecoveries = input.workerRecoveries
    .filter((association) => association.targetId === input.targetId)
    .sort(compareWorkerRecovery)
  return Object.freeze({
    panes: Object.freeze(panes.sort(comparePaneEvidence)),
    leases: Object.freeze([...leases].sort(compareLeaseEvidence)),
    workerRecoveries: Object.freeze(workerRecoveries)
  })
}

function preflightLocalEvidenceCapacity(input: {
  persistedWorkspacePartitions: readonly SshLegacyPersistedWorkspacePartition[]
  persistedPtyLeases: readonly Readonly<SshRemotePtyLease>[]
  workerRecoveries: readonly SshLegacyWorkerRecoveryAssociation[]
}): void {
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
  for (const partition of input.persistedWorkspacePartitions) {
    assertSshLegacyArrayCapacity(
      partition.folderWorkspaces,
      SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.folderWorkspacesPerPartition,
      'folder workspaces per partition'
    )
    const workspaceEntries = boundedSshLegacyRecordEntries(
      partition.session.tabsByWorktree,
      SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.workspaceOwnersPerPartition,
      'workspace owners per partition'
    )
    const layoutEntries = boundedSshLegacyRecordEntries(
      partition.session.terminalLayoutsByTabId,
      SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.layoutsPerPartition,
      'terminal layouts per partition'
    )
    for (const [, tabs] of workspaceEntries) {
      assertSshLegacyArrayCapacity(
        tabs,
        SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.tabsPerWorkspace,
        'terminal tabs per workspace'
      )
    }
    for (const [, layout] of layoutEntries) {
      if (isRecord(layout) && layout.ptyIdsByLeafId !== undefined) {
        boundedSshLegacyRecordEntries(
          layout.ptyIdsByLeafId,
          SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.bindingsPerLayout,
          'terminal layout bindings'
        )
      }
    }
  }
}

function collectPartitionPanes(
  targetId: string,
  partition: SshLegacyPersistedWorkspacePartition,
  physicalPtyIds: ReadonlySet<string>,
  panes: SshLegacyUnresolvedPaneEvidence[]
): void {
  const folders = indexFolderWorkspaces(partition)
  const workspaceEntries = boundedSshLegacyRecordEntries(
    partition.session.tabsByWorktree,
    SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.workspaceOwnersPerPartition,
    'workspace owners per partition'
  )
  for (const [workspaceOwnerId, rawTabs] of workspaceEntries) {
    const reference = workspaceReference(workspaceOwnerId, partition, folders)
    for (const rawTab of rawTabs as readonly unknown[]) {
      if (!isRecord(rawTab)) {
        failSshLegacyMigrationEvidence('malformed', 'persisted terminal tab')
      }
      const tabId = requiredId(rawTab.id, 'persisted terminal tab id')
      const bindings = collectSshLegacyLayoutBindings({
        tabId,
        fallbackPtyId: nullableId(rawTab.ptyId, 'persisted terminal PTY id'),
        layout: partition.session.terminalLayoutsByTabId[tabId]
      })
      for (const binding of bindings) {
        const physicalPtyId = sshLegacyPhysicalPtyId(targetId, binding.ptyId)
        if (physicalPtyId === null || !physicalPtyIds.has(physicalPtyId)) {
          continue
        }
        if (reference === null) {
          failSshLegacyMigrationEvidence('malformed', 'persisted workspace owner')
        }
        panes.push(
          Object.freeze({
            targetId,
            partitionId: partition.partitionId,
            ptyId: binding.ptyId,
            paneKey: binding.paneKey,
            tabId,
            leafId: binding.leafId,
            rendererGeneration: rendererGeneration(rawTab.generation),
            workspaceReference: floatingReference(reference, rawTab, partition)
          })
        )
        if (panes.length > SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.totalLocalPanes) {
          failSshLegacyMigrationEvidence('capacity', 'total local panes')
        }
      }
    }
  }
}

function indexFolderWorkspaces(
  partition: SshLegacyPersistedWorkspacePartition
): ReadonlyMap<string, string> {
  const folders = new Map<string, string>()
  for (const folder of partition.folderWorkspaces) {
    assertAuthorityId(folder.id, 'SSH legacy folder workspace id')
    assertAuthorityStoragePath(folder.folderPath, 'SSH legacy folder workspace path')
    if (folders.has(folder.id)) {
      failSshLegacyMigrationEvidence('ambiguity', 'folder workspace identity')
    }
    folders.set(folder.id, folder.folderPath)
  }
  return folders
}

function workspaceReference(
  workspaceOwnerId: string,
  partition: SshLegacyPersistedWorkspacePartition,
  folders: ReadonlyMap<string, string>
): SshLegacyWorkspaceReference | null {
  return sshLegacyClientWorkspaceReference({
    clientWorkspaceId: workspaceOwnerId,
    folderPathById: folders,
    floatingWorkspacePath: partition.floatingWorkspacePath ?? null
  })
}

function floatingReference(
  reference: SshLegacyWorkspaceReference,
  tab: Readonly<Record<string, unknown>>,
  partition: SshLegacyPersistedWorkspacePartition
): SshLegacyWorkspaceReference {
  if (reference.kind !== 'floating') {
    return reference
  }
  const path =
    tab.startupCwd === undefined
      ? (partition.floatingWorkspacePath ?? null)
      : requiredPath(tab.startupCwd, 'SSH legacy floating workspace path')
  return Object.freeze({ ...reference, path })
}

function validatePartitionIdentity(partition: SshLegacyPersistedWorkspacePartition): void {
  assertAuthorityId(partition.targetId, 'SSH legacy partition targetId')
  assertAuthorityId(partition.partitionId, 'SSH legacy partitionId')
  if (partition.floatingWorkspacePath !== undefined && partition.floatingWorkspacePath !== null) {
    assertAuthorityStoragePath(
      partition.floatingWorkspacePath,
      'SSH legacy floating workspace path'
    )
  }
}

function rendererGeneration(value: unknown): number | null {
  if (value === undefined) {
    return null
  }
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    failSshLegacyMigrationEvidence('malformed', 'persisted renderer generation')
  }
  return Number(value)
}

function requiredId(value: unknown, field: string): string {
  try {
    assertAuthorityId(value, field)
    return value
  } catch {
    failSshLegacyMigrationEvidence('malformed', field)
  }
}

function nullableId(value: unknown, field: string): string | null {
  return value === null ? null : requiredId(value, field)
}

function requiredPath(value: unknown, field: string): string {
  try {
    assertAuthorityStoragePath(value, field)
    return value
  } catch {
    failSshLegacyMigrationEvidence('malformed', field)
  }
}

function comparePaneEvidence(
  left: SshLegacyUnresolvedPaneEvidence,
  right: SshLegacyUnresolvedPaneEvidence
): number {
  return compareSshLegacyText(paneSortKey(left), paneSortKey(right))
}

function paneSortKey(value: SshLegacyUnresolvedPaneEvidence): string {
  return JSON.stringify([
    value.partitionId,
    value.ptyId,
    value.paneKey,
    value.rendererGeneration,
    value.workspaceReference
  ])
}

function compareLeaseEvidence(left: SshRemotePtyLease, right: SshRemotePtyLease): number {
  return compareSshLegacyText(
    JSON.stringify(projectSshLegacyLeaseEvidence(left)),
    JSON.stringify(projectSshLegacyLeaseEvidence(right))
  )
}

function compareWorkerRecovery(
  left: SshLegacyWorkerRecoveryAssociation,
  right: SshLegacyWorkerRecoveryAssociation
): number {
  return compareSshLegacyText(
    JSON.stringify([left.endpointId, left.workerId, left.buildId, left.recovery.clientInstanceId]),
    JSON.stringify([
      right.endpointId,
      right.workerId,
      right.buildId,
      right.recovery.clientInstanceId
    ])
  )
}
