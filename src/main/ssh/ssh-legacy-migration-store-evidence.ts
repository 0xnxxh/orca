import type { FolderWorkspace } from '../../shared/types'
import type { SshPtyConsumerRecovery, SshRemotePtyLease } from '../../shared/ssh-types'
import {
  SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY,
  assertSshLegacyArrayCapacity,
  failSshLegacyMigrationEvidence
} from './ssh-legacy-migration-evidence-capacity'
import type {
  SshLegacyDiscoveredRelayEvidence,
  SshLegacyDiscoveredRelayInventoryRow,
  SshLegacyPersistedWorkspacePartition,
  SshLegacyWorkerRecoveryAssociation,
  SshLegacyWorkspaceReference
} from './ssh-legacy-migration-evidence-bridge-types'
import type {
  SshLegacyInspectedWorker,
  SshLegacyPreparedPhysicalPty
} from './ssh-legacy-migration-coordinator-types'
import { sshLegacyClientWorkspaceReference } from './ssh-legacy-migration-workspace-reference'

/** The narrow persisted surface legacy migration reads; it never writes through this seam. */
export type SshLegacyMigrationEvidenceStore = Readonly<{
  getSshRemotePtyLeases: (targetId?: string) => SshRemotePtyLease[]
  getSshPtyConsumerRecovery: (targetId: string) => SshPtyConsumerRecovery | null
  getWorkspaceSessionHostIds: () => readonly string[]
  getWorkspaceSession: (hostId?: string | null) => Readonly<{
    tabsByWorktree?: unknown
    terminalLayoutsByTabId?: unknown
  }>
  getFolderWorkspaces: () => readonly FolderWorkspace[]
}>

export function sshLegacyFolderPathById(
  store: SshLegacyMigrationEvidenceStore
): ReadonlyMap<string, string> {
  const folders = new Map<string, string>()
  const workspaces = store.getFolderWorkspaces()
  assertSshLegacyArrayCapacity(
    workspaces,
    SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.folderWorkspacesPerPartition,
    'folder workspaces per partition'
  )
  for (const workspace of workspaces) {
    if (typeof workspace.id === 'string' && typeof workspace.folderPath === 'string') {
      folders.set(workspace.id, workspace.folderPath)
    }
  }
  return folders
}

export function sshLegacyPersistedWorkspacePartitions(
  store: SshLegacyMigrationEvidenceStore,
  targetId: string
): readonly SshLegacyPersistedWorkspacePartition[] {
  const hostIds = store.getWorkspaceSessionHostIds()
  assertSshLegacyArrayCapacity(
    hostIds,
    SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.workspacePartitions,
    'workspace partitions'
  )
  const folderWorkspaces = Object.freeze(
    store
      .getFolderWorkspaces()
      .map((workspace) => Object.freeze({ id: workspace.id, folderPath: workspace.folderPath }))
  )
  return Object.freeze(
    hostIds.map((hostId) => {
      const session = store.getWorkspaceSession(hostId)
      return Object.freeze({
        targetId,
        partitionId: hostId,
        session: Object.freeze({
          tabsByWorktree: (session.tabsByWorktree ?? {}) as Record<string, never>,
          terminalLayoutsByTabId: (session.terminalLayoutsByTabId ?? {}) as Record<string, never>
        }),
        folderWorkspaces
      }) as SshLegacyPersistedWorkspacePartition
    })
  )
}

export function sshLegacyWorkerRecoveryAssociations(
  input: Readonly<{
    store: SshLegacyMigrationEvidenceStore
    targetId: string
    endpointId: string
    workerId: string
    buildId: string
  }>
): readonly SshLegacyWorkerRecoveryAssociation[] {
  const recovery = input.store.getSshPtyConsumerRecovery(input.targetId)
  // Why filtered here: a recovery minted against another build is not evidence about this worker,
  // and forwarding it would make the association ambiguous instead of absent.
  if (
    !recovery ||
    recovery.targetId !== input.targetId ||
    recovery.serverBuildId !== input.buildId
  ) {
    return Object.freeze([])
  }
  return Object.freeze([
    Object.freeze({
      targetId: input.targetId,
      endpointId: input.endpointId,
      workerId: input.workerId,
      buildId: input.buildId,
      recovery: Object.freeze({ ...recovery })
    })
  ])
}

export function sshLegacyDiscoveredRelayEvidence(
  input: Readonly<{
    targetId: string
    endpointId: string
    observedAtMs: number
    folderPathById: ReadonlyMap<string, string>
    referenceByPaneKey: ReadonlyMap<string, SshLegacyWorkspaceReference>
    workers: readonly SshLegacyInspectedWorker[]
  }>
): readonly SshLegacyDiscoveredRelayEvidence[] {
  return Object.freeze(
    input.workers.map((worker) =>
      Object.freeze({
        targetId: input.targetId,
        endpointId: input.endpointId,
        workerId: worker.inspection.workerId,
        buildId: worker.inspection.buildId,
        observedAtMs: input.observedAtMs,
        identityProof: worker.inspection.identityProof,
        rows: Object.freeze(worker.inspection.ptys.map((pty) => inventoryRow(pty, input)))
      })
    )
  )
}

function inventoryRow(
  pty: SshLegacyPreparedPhysicalPty,
  input: Readonly<{
    folderPathById: ReadonlyMap<string, string>
    referenceByPaneKey: ReadonlyMap<string, SshLegacyWorkspaceReference>
  }>
): SshLegacyDiscoveredRelayInventoryRow {
  return Object.freeze({
    physicalPtyId: pty.id,
    ptyIncarnationId: pty.incarnationId,
    processId: pty.processId,
    workspaceReference: inventoryWorkspaceReference(pty, input),
    serialized: pty.serialized
  })
}

/**
 * The pane the row serialized is the only evidence that separates a folder workspace from a
 * floating one, so it is preferred. A row that names no known pane still resolves to a plain host
 * workspace: it matches nothing exactly and stays in recovery instead of failing the inventory.
 */
function inventoryWorkspaceReference(
  pty: SshLegacyPreparedPhysicalPty,
  input: Readonly<{
    folderPathById: ReadonlyMap<string, string>
    referenceByPaneKey: ReadonlyMap<string, SshLegacyWorkspaceReference>
  }>
): SshLegacyWorkspaceReference {
  const paneReference = pty.serialized.paneKey
    ? input.referenceByPaneKey.get(pty.serialized.paneKey)
    : undefined
  if (paneReference) {
    return paneReference
  }
  const clientWorkspaceId = pty.serialized.worktreeId ?? pty.worktreeId ?? null
  const reference =
    clientWorkspaceId === null
      ? null
      : sshLegacyClientWorkspaceReference({
          clientWorkspaceId,
          folderPathById: input.folderPathById,
          floatingWorkspacePath: pty.serialized.cwd ?? pty.cwd
        })
  return reference ?? Object.freeze({ kind: 'workspace-path', path: pty.serialized.cwd ?? pty.cwd })
}

export function sshLegacyReferenceByPaneKey(
  panes: readonly Readonly<{
    paneKey: string
    workspaceReference: SshLegacyWorkspaceReference
  }>[]
): ReadonlyMap<string, SshLegacyWorkspaceReference> {
  const index = new Map<string, SshLegacyWorkspaceReference>()
  for (const pane of panes) {
    const existing = index.get(pane.paneKey)
    if (existing && JSON.stringify(existing) !== JSON.stringify(pane.workspaceReference)) {
      failSshLegacyMigrationEvidence('ambiguity', 'pane workspace reference')
    }
    index.set(pane.paneKey, pane.workspaceReference)
  }
  return index
}
