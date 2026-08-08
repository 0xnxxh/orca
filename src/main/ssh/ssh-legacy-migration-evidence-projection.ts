import type { TerminalLegacyWorkspaceEvidence } from '../../shared/terminal-legacy-cutover'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { SshRemotePtyLease } from '../../shared/ssh-types'
import { compareSshLegacyEvidence } from './ssh-legacy-migration-evidence-identity'
import type {
  SshLegacyLayoutPaneEvidence,
  SshLegacyLiveRelayInventory,
  SshLegacyPersistedConsumerEvidence,
  SshLegacyRelayIdentityProof,
  SshLegacyRelayInventoryRow,
  SshLegacySerializedPtyEvidence
} from './ssh-legacy-migration-inventory-types'

export function projectSshLegacyConsumerEvidence(
  value: SshLegacyPersistedConsumerEvidence
): Readonly<Record<string, unknown>> {
  return {
    targetId: value.targetId,
    workerId: value.workerId,
    clientInstanceId: value.clientInstanceId,
    serverBuildId: value.serverBuildId
  }
}

export function projectSshLegacyLeaseEvidence(
  value: SshRemotePtyLease
): Readonly<Record<string, unknown>> {
  return {
    targetId: value.targetId,
    ptyId: value.ptyId,
    incarnationId: value.incarnationId ?? null,
    worktreeId: value.worktreeId ?? null,
    tabId: value.tabId ?? null,
    leafId: value.leafId ?? null,
    paneGeneration: value.paneGeneration ?? null
  }
}

export function projectSshLegacyPaneEvidence(
  value: SshLegacyLayoutPaneEvidence
): Readonly<Record<string, unknown>> {
  return {
    targetId: value.targetId,
    partitionId: value.partitionId,
    ptyId: value.ptyId,
    paneKey: value.paneKey,
    tabId: value.tabId,
    leafId: value.leafId,
    rendererGeneration: value.rendererGeneration,
    namespace: projectNamespace(value.namespace),
    workspace: projectWorkspace(value.workspace)
  }
}

export function projectSshLegacyRelayEvidence(
  value: SshLegacyLiveRelayInventory,
  includeRows: boolean
): Readonly<Record<string, unknown>> {
  return {
    workerId: value.workerId,
    buildId: value.buildId,
    observedAtMs: value.observedAtMs,
    identityProof: projectSshLegacyRelayIdentityProof(value.identityProof),
    ...(includeRows
      ? { rows: sortSshLegacyEvidence(value.rows, projectSshLegacyInventoryRowEvidence) }
      : {})
  }
}

export function projectSshLegacyInventoryRowEvidence(
  value: SshLegacyRelayInventoryRow
): Readonly<Record<string, unknown>> {
  return {
    workerId: value.workerId,
    buildId: value.buildId,
    physicalPtyId: value.physicalPtyId,
    ptyIncarnationId: value.ptyIncarnationId,
    processId: value.processId,
    namespace: projectNamespace(value.namespace),
    workspace: projectWorkspace(value.workspace),
    serialized: projectSerializedEvidence(value.serialized)
  }
}

export function projectSshLegacySourceEvidence(
  value: Readonly<{
    relay: SshLegacyLiveRelayInventory
    row: SshLegacyRelayInventoryRow
  }>
): Readonly<Record<string, unknown>> {
  return {
    relay: projectSshLegacyRelayEvidence(value.relay, false),
    row: projectSshLegacyInventoryRowEvidence(value.row)
  }
}

export function sortSshLegacyEvidence<T>(
  values: readonly T[],
  project: (value: T) => unknown
): T[] {
  return [...values].sort((left, right) => compareSshLegacyEvidence(project(left), project(right)))
}

function projectNamespace(value: TerminalAuthorityNamespace): Readonly<Record<string, unknown>> {
  return { authorityHostId: value.authorityHostId, namespaceId: value.namespaceId }
}

function projectWorkspace(
  value: TerminalLegacyWorkspaceEvidence
): Readonly<Record<string, unknown>> {
  const locator =
    value.locator.kind === 'floating'
      ? { kind: 'floating' }
      : {
          kind: 'workspace',
          canonicalPath: value.locator.canonicalPath,
          pathFlavor: value.locator.pathFlavor
        }
  return {
    kind: value.kind,
    locator,
    ...(value.kind === 'git-worktree' ? { worktreeId: value.worktreeId } : {})
  }
}

export function projectSshLegacyRelayIdentityProof(
  value: SshLegacyRelayIdentityProof
): Readonly<Record<string, unknown>> {
  return {
    expectedEndpoint: projectSshLegacyEndpointIdentity(value.expectedEndpoint),
    observedEndpoint: projectSshLegacyEndpointIdentity(value.observedEndpoint),
    expectedProcess: projectSshLegacyProcessIdentity(value.expectedProcess),
    observedProcess: projectSshLegacyProcessIdentity(value.observedProcess)
  }
}

export function projectSshLegacyEndpointIdentity(
  value: SshLegacyRelayIdentityProof['expectedEndpoint']
): unknown {
  if (value === null) {
    return null
  }
  return value.kind === 'unix-socket'
    ? {
        kind: value.kind,
        device: value.device,
        inode: value.inode,
        changedAtNs: value.changedAtNs
      }
    : {
        kind: value.kind,
        pipeName: value.pipeName,
        processCreationMarker: value.processCreationMarker
      }
}

export function projectSshLegacyProcessIdentity(
  value: SshLegacyRelayIdentityProof['expectedProcess']
): unknown {
  return value === null ? null : { pid: value.pid, birthMarker: value.birthMarker }
}

function projectSerializedEvidence(
  value: SshLegacySerializedPtyEvidence
): Readonly<Record<string, unknown>> {
  return {
    paneKey: value.paneKey,
    tabId: value.tabId,
    worktreeId: value.worktreeId,
    cwd: value.cwd,
    ptyIncarnationId: value.ptyIncarnationId,
    processId: value.processId
  }
}
