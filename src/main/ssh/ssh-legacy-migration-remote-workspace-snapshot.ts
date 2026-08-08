import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/constants'
import {
  assertAuthorityId,
  assertAuthorityStoragePath,
  isRecord
} from '../../shared/terminal-session-authority-identity'
import {
  compareSshLegacyText,
  sshLegacyPhysicalPtyId
} from './ssh-legacy-migration-evidence-identity'
import {
  SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY,
  assertSshLegacyArrayCapacity,
  boundedSshLegacyRecordEntries,
  failSshLegacyMigrationEvidence
} from './ssh-legacy-migration-evidence-capacity'
import type {
  SshLegacyUnresolvedPaneEvidence,
  SshLegacyWorkspaceReference
} from './ssh-legacy-migration-evidence-bridge-types'
import { collectSshLegacyLayoutBindings } from './ssh-legacy-migration-layout-evidence'

export function parseSshLegacyRemoteWorkspaceSnapshotEvidence(input: {
  targetId: string
  partitionId: string
  snapshot: unknown
}): readonly SshLegacyUnresolvedPaneEvidence[] {
  assertIdentity(input.targetId, 'remote snapshot targetId')
  assertIdentity(input.partitionId, 'remote snapshot partitionId')
  const session = preflightRemoteSnapshot(input.snapshot)
  const tabIds = new Set<string>()
  const panes: SshLegacyUnresolvedPaneEvidence[] = []
  const workspaceEntries = boundedSshLegacyRecordEntries(
    session.tabsByWorktreePath,
    SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.remoteWorkspacePaths,
    'remote workspace paths'
  )
  for (const [workspacePath, rawTabs] of workspaceEntries) {
    assertPath(workspacePath, 'remote workspace path')
    for (const rawTab of rawTabs as readonly unknown[]) {
      if (!isRecord(rawTab)) {
        failSshLegacyMigrationEvidence('malformed', 'remote workspace tab')
      }
      const tabId = requiredId(rawTab.id, 'remote workspace tab id')
      if (tabIds.has(tabId)) {
        failSshLegacyMigrationEvidence('ambiguity', 'remote workspace tab identity')
      }
      tabIds.add(tabId)
      if (rawTab.worktreePath !== workspacePath) {
        failSshLegacyMigrationEvidence('malformed', 'remote workspace tab path')
      }
      const bindings = collectSshLegacyLayoutBindings({
        tabId,
        fallbackPtyId: nullableId(rawTab.ptyId, 'remote workspace PTY id'),
        layout: session.terminalLayoutsByTabId[tabId]
      })
      const reference = remoteWorkspaceReference(workspacePath, rawTab)
      for (const binding of bindings) {
        if (sshLegacyPhysicalPtyId(input.targetId, binding.ptyId) === null) {
          continue
        }
        panes.push(
          Object.freeze({
            targetId: input.targetId,
            partitionId: input.partitionId,
            ptyId: binding.ptyId,
            paneKey: binding.paneKey,
            tabId,
            leafId: binding.leafId,
            rendererGeneration: rendererGeneration(rawTab.generation),
            workspaceReference: reference
          })
        )
        if (panes.length > SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.totalRemotePanes) {
          failSshLegacyMigrationEvidence('capacity', 'total remote snapshot panes')
        }
      }
    }
  }
  return Object.freeze(panes.sort(comparePaneEvidence))
}

type RemoteSnapshotSessionEvidence = Readonly<{
  tabsByWorktreePath: Readonly<Record<string, unknown>>
  terminalLayoutsByTabId: Readonly<Record<string, unknown>>
}>

function preflightRemoteSnapshot(snapshot: unknown): RemoteSnapshotSessionEvidence {
  if (!isRecord(snapshot) || !isRecord(snapshot.session)) {
    failSshLegacyMigrationEvidence('malformed', 'remote workspace snapshot')
  }
  if (snapshot.namespace !== undefined) {
    requiredId(snapshot.namespace, 'remote snapshot routing namespace')
  }
  const session = snapshot.session
  const workspaceEntries = boundedSshLegacyRecordEntries(
    session.tabsByWorktreePath,
    SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.remoteWorkspacePaths,
    'remote workspace paths'
  )
  const layoutEntries = boundedSshLegacyRecordEntries(
    session.terminalLayoutsByTabId,
    SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.layoutsPerPartition,
    'remote terminal layouts'
  )
  let totalTabs = 0
  for (const [, tabs] of workspaceEntries) {
    assertSshLegacyArrayCapacity(
      tabs,
      SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.tabsPerWorkspace,
      'remote tabs per workspace'
    )
    totalTabs += tabs.length
    if (totalTabs > SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.totalRemoteTabs) {
      failSshLegacyMigrationEvidence('capacity', 'total remote tabs')
    }
  }
  for (const [, layout] of layoutEntries) {
    if (isRecord(layout) && layout.ptyIdsByLeafId !== undefined) {
      boundedSshLegacyRecordEntries(
        layout.ptyIdsByLeafId,
        SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.bindingsPerLayout,
        'remote terminal layout bindings'
      )
    }
  }
  return Object.freeze({
    tabsByWorktreePath: session.tabsByWorktreePath as Readonly<Record<string, unknown>>,
    terminalLayoutsByTabId: session.terminalLayoutsByTabId as Readonly<Record<string, unknown>>
  })
}

function remoteWorkspaceReference(
  workspacePath: string,
  tab: Readonly<Record<string, unknown>>
): SshLegacyWorkspaceReference {
  if (workspacePath !== FLOATING_TERMINAL_WORKTREE_ID) {
    return Object.freeze({ kind: 'workspace-path', path: workspacePath })
  }
  const path =
    tab.startupCwd === undefined
      ? null
      : requiredPath(tab.startupCwd, 'remote floating workspace path')
  return Object.freeze({
    kind: 'floating',
    clientWorkspaceId: FLOATING_TERMINAL_WORKTREE_ID,
    path
  })
}

function rendererGeneration(value: unknown): number | null {
  if (value === undefined) {
    return null
  }
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    failSshLegacyMigrationEvidence('malformed', 'remote renderer generation')
  }
  return Number(value)
}

function assertIdentity(value: unknown, field: string): void {
  try {
    assertAuthorityId(value, field)
  } catch {
    failSshLegacyMigrationEvidence('malformed', field)
  }
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

function assertPath(value: unknown, field: string): void {
  try {
    assertAuthorityStoragePath(value, field)
  } catch {
    failSshLegacyMigrationEvidence('malformed', field)
  }
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
  return compareSshLegacyText(
    JSON.stringify([
      left.partitionId,
      left.ptyId,
      left.paneKey,
      left.rendererGeneration,
      left.workspaceReference
    ]),
    JSON.stringify([
      right.partitionId,
      right.ptyId,
      right.paneKey,
      right.rendererGeneration,
      right.workspaceReference
    ])
  )
}
