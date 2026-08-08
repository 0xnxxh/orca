import {
  assertAuthorityNamespace,
  assertAuthorityStoragePath
} from '../../shared/terminal-session-authority-identity'
import { assertTerminalAuthorityNamespaceLocator } from '../../shared/terminal-session-authority-locator'
import {
  projectSshLegacyInventoryRowEvidence,
  sortSshLegacyEvidence
} from './ssh-legacy-migration-evidence-projection'
import {
  SshLegacyMigrationEvidenceError,
  failSshLegacyMigrationEvidence
} from './ssh-legacy-migration-evidence-capacity'
import type {
  SshLegacyDiscoveredRelayEvidence,
  SshLegacyDiscoveredRelayInventoryRow,
  SshLegacyMigrationEvidenceBridgeInput,
  SshLegacyUnresolvedPaneEvidence,
  SshLegacyWorkspaceReference,
  SshLegacyWorkspaceResolution,
  SshLegacyWorkspaceResolutionRequest
} from './ssh-legacy-migration-evidence-bridge-types'
import type { SshLegacyResolvedPane } from './ssh-legacy-migration-lease-normalization'
import type {
  SshLegacyLiveRelayInventory,
  SshLegacyRelayInventoryRow,
  SshLegacySerializedPtyEvidence
} from './ssh-legacy-migration-inventory-types'
import { assertSshLegacyDiscoveredRelayIdentity } from './ssh-legacy-migration-consumer-association'

export async function resolveSshLegacyPanes(
  input: SshLegacyMigrationEvidenceBridgeInput,
  panes: readonly SshLegacyUnresolvedPaneEvidence[],
  source: 'local-layout' | 'remote-snapshot'
): Promise<readonly SshLegacyResolvedPane[]> {
  const resolved: SshLegacyResolvedPane[] = []
  for (const raw of panes) {
    const resolution = await resolveWorkspace(input, {
      targetId: input.targetId,
      authorityHostId: input.authorityHostId,
      hostPathFlavor: input.hostPathFlavor,
      source,
      partitionId: raw.partitionId,
      endpointId: null,
      reference: raw.workspaceReference
    })
    resolved.push(
      Object.freeze({
        raw,
        pane: Object.freeze({
          targetId: input.targetId,
          partitionId: raw.partitionId,
          ptyId: raw.ptyId,
          paneKey: raw.paneKey,
          tabId: raw.tabId,
          leafId: raw.leafId,
          rendererGeneration: raw.rendererGeneration,
          namespace: resolution.namespace,
          workspace: resolution.workspace
        })
      })
    )
  }
  return Object.freeze(resolved)
}

export async function resolveSshLegacyRelays(
  input: SshLegacyMigrationEvidenceBridgeInput,
  relays: readonly SshLegacyDiscoveredRelayEvidence[]
): Promise<readonly SshLegacyLiveRelayInventory[]> {
  const resolved: SshLegacyLiveRelayInventory[] = []
  for (const relay of relays) {
    assertSshLegacyDiscoveredRelayIdentity(relay)
    const rows: SshLegacyRelayInventoryRow[] = []
    for (const row of relay.rows) {
      const resolution = await resolveWorkspace(input, {
        targetId: input.targetId,
        authorityHostId: input.authorityHostId,
        hostPathFlavor: input.hostPathFlavor,
        source: 'relay-inventory',
        partitionId: null,
        endpointId: relay.endpointId,
        reference: row.workspaceReference
      })
      rows.push(resolveRelayRow(relay, row, resolution))
    }
    resolved.push(
      Object.freeze({
        workerId: relay.workerId,
        buildId: relay.buildId,
        observedAtMs: relay.observedAtMs,
        identityProof: relay.identityProof,
        rows: Object.freeze(sortSshLegacyEvidence(rows, projectSshLegacyInventoryRowEvidence))
      })
    )
  }
  return Object.freeze(resolved)
}

function resolveRelayRow(
  relay: SshLegacyDiscoveredRelayEvidence,
  row: SshLegacyDiscoveredRelayInventoryRow,
  resolution: SshLegacyWorkspaceResolution
): SshLegacyRelayInventoryRow {
  return Object.freeze({
    workerId: relay.workerId,
    buildId: relay.buildId,
    physicalPtyId: row.physicalPtyId,
    ptyIncarnationId: row.ptyIncarnationId,
    processId: row.processId,
    namespace: resolution.namespace,
    workspace: resolution.workspace,
    serialized: Object.freeze({
      ...row.serialized,
      worktreeId: normalizedSerializedWorktreeId(row.serialized, row.workspaceReference, resolution)
    })
  })
}

async function resolveWorkspace(
  input: SshLegacyMigrationEvidenceBridgeInput,
  request: SshLegacyWorkspaceResolutionRequest
): Promise<SshLegacyWorkspaceResolution> {
  let resolution: SshLegacyWorkspaceResolution
  try {
    resolution = await input.resolveWorkspace(Object.freeze(request))
    assertAuthorityNamespace(resolution.namespace)
    assertResolvedWorkspace(resolution)
  } catch (error) {
    if (error instanceof SshLegacyMigrationEvidenceError) {
      throw error
    }
    failSshLegacyMigrationEvidence('resolution', 'workspace callback')
  }
  if (
    resolution.namespace.authorityHostId !== input.authorityHostId ||
    !resolutionMatchesReference(request.reference, resolution)
  ) {
    failSshLegacyMigrationEvidence('resolution', 'workspace callback identity')
  }
  if (
    resolution.workspace.locator.kind === 'workspace' &&
    resolution.workspace.locator.pathFlavor !== input.hostPathFlavor
  ) {
    failSshLegacyMigrationEvidence('resolution', 'workspace callback path flavor')
  }
  return Object.freeze({
    namespace: Object.freeze({ ...resolution.namespace }),
    workspace: Object.freeze(resolution.workspace)
  })
}

function normalizedSerializedWorktreeId(
  serialized: SshLegacySerializedPtyEvidence,
  reference: SshLegacyWorkspaceReference,
  resolution: SshLegacyWorkspaceResolution
): string | null {
  const expected =
    resolution.workspace.kind === 'git-worktree' ? resolution.workspace.worktreeId : null
  if (
    serialized.worktreeId === expected ||
    ('clientWorkspaceId' in reference && serialized.worktreeId === reference.clientWorkspaceId) ||
    (expected === null && serialized.worktreeId === null)
  ) {
    return expected
  }
  return serialized.worktreeId
}

function resolutionMatchesReference(
  reference: SshLegacyWorkspaceReference,
  resolution: SshLegacyWorkspaceResolution
): boolean {
  return (
    (reference.kind === 'workspace-path' && resolution.workspace.kind !== 'floating') ||
    (reference.kind === 'git-worktree' && resolution.workspace.kind === 'git-worktree') ||
    (reference.kind === 'folder-workspace' && resolution.workspace.kind === 'folder') ||
    (reference.kind === 'floating' && resolution.workspace.kind === 'floating')
  )
}

function assertResolvedWorkspace(resolution: SshLegacyWorkspaceResolution): void {
  assertTerminalAuthorityNamespaceLocator(resolution.workspace.locator)
  if (resolution.workspace.kind === 'git-worktree') {
    if (resolution.workspace.locator.kind !== 'workspace') {
      throw new Error('resolved git workspace locator is invalid')
    }
    assertAuthorityStoragePath(resolution.workspace.worktreeId, 'SSH legacy resolved worktreeId')
    return
  }
  if (resolution.workspace.kind === 'folder') {
    if (resolution.workspace.locator.kind !== 'workspace') {
      throw new Error('resolved folder workspace locator is invalid')
    }
    return
  }
  if (
    resolution.workspace.kind !== 'floating' ||
    resolution.workspace.locator.kind !== 'floating'
  ) {
    throw new Error('resolved floating workspace locator is invalid')
  }
}
