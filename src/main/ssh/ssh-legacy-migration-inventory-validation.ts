import type {
  TerminalLegacyEndpointIdentity,
  TerminalLegacyProcessIdentity,
  TerminalLegacyWorkspaceEvidence
} from '../../shared/terminal-legacy-cutover'
import {
  assertAuthorityId,
  assertAuthorityNamespace,
  assertAuthorityStoragePath,
  isRecord
} from '../../shared/terminal-session-authority-identity'
import {
  assertTerminalAuthorityNamespaceLocator,
  type TerminalAuthorityPathFlavor
} from '../../shared/terminal-session-authority-locator'
import type { SshRemotePtyLease } from '../../shared/ssh-types'
import type {
  SshLegacyLayoutPaneEvidence,
  SshLegacyMigrationInventoryInput,
  SshLegacyRelayIdentityProof,
  SshLegacyRelayInventoryRow,
  SshLegacySerializedPtyEvidence
} from './ssh-legacy-migration-inventory-types'

const LEASE_STATES = new Set(['attached', 'detached', 'terminated', 'expired'])

export function assertSshLegacyMigrationInventoryInput(
  input: SshLegacyMigrationInventoryInput
): void {
  assertAuthorityId(input.targetId, 'SSH legacy targetId')
  assertAuthorityId(input.authorityHostId, 'SSH legacy authorityHostId')
  if (input.hostPathFlavor !== 'posix' && input.hostPathFlavor !== 'windows') {
    throw new Error('SSH legacy host path flavor is invalid')
  }
  for (const recovery of input.persistedConsumerRecoveries) {
    assertAuthorityId(recovery.targetId, 'SSH legacy consumer targetId')
    assertAuthorityId(recovery.workerId, 'SSH legacy consumer workerId')
    assertAuthorityId(recovery.clientInstanceId, 'SSH legacy consumer recovery ID')
    assertAuthorityId(recovery.serverBuildId, 'SSH legacy consumer build ID')
  }
  for (const lease of input.persistedPtyLeases) {
    assertLease(lease)
  }
  for (const pane of input.localLayoutPanes) {
    assertPane(
      pane,
      pane.targetId === input.targetId ? input.hostPathFlavor : undefined,
      input.authorityHostId
    )
  }
  for (const pane of input.remoteSnapshotPanes) {
    assertPane(
      pane,
      pane.targetId === input.targetId ? input.hostPathFlavor : undefined,
      input.authorityHostId
    )
  }
  for (const relay of input.liveRelays) {
    assertAuthorityId(relay.workerId, 'SSH legacy relay workerId')
    assertAuthorityId(relay.buildId, 'SSH legacy relay buildId')
    assertNonNegativeInteger(relay.observedAtMs, 'SSH legacy relay observedAtMs')
    assertIdentityProof(relay.identityProof)
    for (const row of relay.rows) {
      assertInventoryRow(row, input.hostPathFlavor, input.authorityHostId)
    }
  }
}

function assertLease(lease: SshRemotePtyLease): void {
  assertAuthorityId(lease.targetId, 'SSH legacy lease targetId')
  assertAuthorityId(lease.ptyId, 'SSH legacy lease ptyId')
  assertOptionalId(lease.incarnationId, 'SSH legacy lease incarnationId')
  assertOptionalPath(lease.worktreeId, 'SSH legacy lease worktreeId')
  assertOptionalId(lease.tabId, 'SSH legacy lease tabId')
  assertOptionalId(lease.leafId, 'SSH legacy lease leafId')
  if (lease.paneGeneration !== undefined) {
    assertNonNegativeInteger(lease.paneGeneration, 'SSH legacy lease paneGeneration')
  }
  if (!LEASE_STATES.has(lease.state)) {
    throw new Error('SSH legacy lease state is invalid')
  }
  assertNonNegativeInteger(lease.createdAt, 'SSH legacy lease createdAt')
  assertNonNegativeInteger(lease.updatedAt, 'SSH legacy lease updatedAt')
  assertOptionalNonNegativeInteger(lease.lastAttachedAt, 'SSH legacy lease lastAttachedAt')
  assertOptionalNonNegativeInteger(lease.lastDetachedAt, 'SSH legacy lease lastDetachedAt')
}

function assertPane(
  pane: SshLegacyLayoutPaneEvidence,
  flavor: TerminalAuthorityPathFlavor | undefined,
  authorityHostId: string
): void {
  assertAuthorityId(pane.targetId, 'SSH legacy pane targetId')
  assertAuthorityId(pane.partitionId, 'SSH legacy pane partitionId')
  assertAuthorityId(pane.ptyId, 'SSH legacy pane ptyId')
  assertNullableId(pane.paneKey, 'SSH legacy pane paneKey')
  assertNullableId(pane.tabId, 'SSH legacy pane tabId')
  assertNullableId(pane.leafId, 'SSH legacy pane leafId')
  if (pane.rendererGeneration !== null) {
    assertNonNegativeInteger(pane.rendererGeneration, 'SSH legacy pane rendererGeneration')
  }
  assertAuthorityNamespace(pane.namespace)
  assertNamespaceHost(pane.namespace.authorityHostId, authorityHostId)
  assertWorkspace(pane.workspace, flavor)
}

function assertInventoryRow(
  row: SshLegacyRelayInventoryRow,
  flavor: TerminalAuthorityPathFlavor | undefined,
  authorityHostId: string
): void {
  assertAuthorityId(row.workerId, 'SSH legacy inventory workerId')
  assertAuthorityId(row.buildId, 'SSH legacy inventory buildId')
  assertAuthorityId(row.physicalPtyId, 'SSH legacy inventory physicalPtyId')
  assertNullableId(row.ptyIncarnationId, 'SSH legacy inventory ptyIncarnationId')
  assertNullablePositiveInteger(row.processId, 'SSH legacy inventory processId')
  assertAuthorityNamespace(row.namespace)
  assertNamespaceHost(row.namespace.authorityHostId, authorityHostId)
  assertWorkspace(row.workspace, flavor)
  assertSerializedEvidence(row.serialized)
}

function assertNamespaceHost(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error('SSH legacy namespace authority host does not match its marker')
  }
}

function assertSerializedEvidence(value: SshLegacySerializedPtyEvidence): void {
  assertNullableId(value.paneKey, 'SSH legacy serialized paneKey')
  assertNullableId(value.tabId, 'SSH legacy serialized tabId')
  assertNullablePath(value.worktreeId, 'SSH legacy serialized worktreeId')
  assertNullablePath(value.cwd, 'SSH legacy serialized cwd')
  assertNullableId(value.ptyIncarnationId, 'SSH legacy serialized ptyIncarnationId')
  assertNullablePositiveInteger(value.processId, 'SSH legacy serialized processId')
}

function assertWorkspace(
  workspace: TerminalLegacyWorkspaceEvidence,
  flavor: TerminalAuthorityPathFlavor | undefined
): void {
  if (!isRecord(workspace) || !isRecord(workspace.locator)) {
    throw new Error('SSH legacy workspace evidence is invalid')
  }
  assertTerminalAuthorityNamespaceLocator(workspace.locator)
  if (
    flavor !== undefined &&
    workspace.locator.kind === 'workspace' &&
    workspace.locator.pathFlavor !== flavor
  ) {
    throw new Error('SSH legacy workspace path flavor does not match its host')
  }
  if (workspace.kind === 'git-worktree') {
    if (workspace.locator.kind !== 'workspace') {
      throw new Error('SSH legacy git workspace locator is invalid')
    }
    assertAuthorityStoragePath(workspace.worktreeId, 'SSH legacy worktreeId')
    return
  }
  if (workspace.kind === 'folder') {
    if (workspace.locator.kind !== 'workspace') {
      throw new Error('SSH legacy folder locator is invalid')
    }
    return
  }
  if (workspace.kind !== 'floating' || workspace.locator.kind !== 'floating') {
    throw new Error('SSH legacy floating locator is invalid')
  }
}

function assertIdentityProof(proof: SshLegacyRelayIdentityProof): void {
  assertNullableEndpoint(proof.expectedEndpoint)
  assertNullableEndpoint(proof.observedEndpoint)
  assertNullableProcess(proof.expectedProcess)
  assertNullableProcess(proof.observedProcess)
}

function assertNullableEndpoint(value: TerminalLegacyEndpointIdentity | null): void {
  if (value === null) {
    return
  }
  if (value.kind === 'unix-socket') {
    if (
      ![value.device, value.inode, value.changedAtNs].every(
        (part) => typeof part === 'string' && /^[0-9]+$/.test(part)
      )
    ) {
      throw new Error('SSH legacy Unix endpoint identity is invalid')
    }
    return
  }
  if (value.kind !== 'windows-named-pipe') {
    throw new Error('SSH legacy endpoint identity kind is invalid')
  }
  assertAuthorityStoragePath(value.pipeName, 'SSH legacy pipe name')
  assertAuthorityId(value.processCreationMarker, 'SSH legacy pipe process marker')
}

function assertNullableProcess(value: TerminalLegacyProcessIdentity | null): void {
  if (value === null) {
    return
  }
  assertPositiveInteger(value.pid, 'SSH legacy worker pid')
  assertAuthorityId(value.birthMarker, 'SSH legacy worker birth marker')
}

function assertNullableId(value: string | null, field: string): void {
  if (value !== null) {
    assertAuthorityId(value, field)
  }
}

function assertOptionalId(value: string | undefined, field: string): void {
  if (value !== undefined) {
    assertAuthorityId(value, field)
  }
}

function assertNullablePath(value: string | null, field: string): void {
  if (value !== null) {
    assertAuthorityStoragePath(value, field)
  }
}

function assertOptionalPath(value: string | undefined, field: string): void {
  if (value !== undefined) {
    assertAuthorityStoragePath(value, field)
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} is invalid`)
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} is invalid`)
  }
}

function assertNullablePositiveInteger(value: number | null, field: string): void {
  if (value !== null) {
    assertPositiveInteger(value, field)
  }
}

function assertOptionalNonNegativeInteger(value: number | undefined, field: string): void {
  if (value !== undefined) {
    assertNonNegativeInteger(value, field)
  }
}
