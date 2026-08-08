import {
  assertAuthorityId,
  assertAuthorityNamespace,
  assertAuthorityStoragePath,
  assertPaneGeneration,
  assertTerminalBinding,
  isRecord
} from './terminal-session-authority-identity'
import {
  assertTerminalAuthorityNamespaceLocator,
  type TerminalAuthorityNamespaceLocator
} from './terminal-session-authority-locator'
import type {
  TerminalLegacyRecoveryProjection,
  TerminalLegacyRecoveryReason
} from './terminal-legacy-cutover'

const MAX_GC_PATHS = 8_192

export function assertTerminalLegacyRecoveryProjection(
  value: unknown
): asserts value is TerminalLegacyRecoveryProjection {
  assertRecoveryBase(value)
  if (!isRecord(value)) {
    throw new Error('legacy recovery is invalid')
  }
  assertAuthorityId(value.catalogReceiptId, 'legacy catalogReceiptId')
  if (value.status === 'imported') {
    assertAuthorityId(value.routeId, 'legacy recovery routeId')
    assertPaneGeneration(value.pane)
    assertTerminalBinding(value.binding)
    assertAuthorityId(value.allocationId, 'legacy recovery allocationId')
    assertAuthorityId(value.spawnFingerprint, 'legacy recovery spawnFingerprint')
    assertImportMatchEvidence(value.matchEvidence)
    assertResolutionProvenance(value.resolvedFrom)
    return
  }
  if (
    !['unresolved', 'acknowledged'].includes(String(value.status)) ||
    !isRecoveryReason(value.reason)
  ) {
    throw new Error('legacy recovery status is invalid')
  }
  assertAuthorityId(value.evidenceCode, 'legacy recovery evidenceCode')
  assertPreservationFacts(value.preservation)
  if (value.status === 'acknowledged') {
    assertAuthorityId(value.previousCatalogReceiptId, 'legacy previousCatalogReceiptId')
    assertAuthorityId(value.acknowledgementCode, 'legacy acknowledgementCode')
    assertTimestamp(value.acknowledgedAtMs, 'legacy acknowledgedAtMs')
  }
}

function assertResolutionProvenance(value: unknown): void {
  if (value === null) {
    return
  }
  if (!isRecord(value) || !isRecoveryReason(value.reason)) {
    throw new Error('legacy recovery resolution provenance is invalid')
  }
  assertAuthorityId(value.catalogReceiptId, 'legacy resolved catalogReceiptId')
  assertAuthorityId(value.evidenceCode, 'legacy resolved evidenceCode')
}

export function assertCandidateBase(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('legacy migration candidate is invalid')
  }
  assertAuthorityId(value.recoveryId, 'legacy recoveryId')
  assertAuthorityNamespace(value.namespace)
  assertWorkspaceEvidence(value.workspace)
  assertPhysicalPtyIdentity(value.physicalPty)
  assertInventoryEvidence(value.inventoryEvidence)
}

export function assertImportMatchEvidence(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.localLease) || !isRecord(value.uniqueness)) {
    throw new Error('legacy import match evidence is invalid')
  }
  for (const [field, selected] of [
    ['leaseId', value.localLease.leaseId],
    ['paneKey', value.localLease.paneKey],
    ['paneGenerationId', value.localLease.paneGenerationId],
    ['tabId', value.localLease.tabId]
  ] as const) {
    assertAuthorityId(selected, `legacy local lease ${field}`)
  }
  if (
    !Number.isSafeInteger(value.localLease.rendererGeneration) ||
    Number(value.localLease.rendererGeneration) < 0
  ) {
    throw new Error('legacy rendererGeneration is invalid')
  }
  if (value.localLease.worktreeId !== null) {
    assertAuthorityStoragePath(value.localLease.worktreeId, 'legacy local lease worktreeId')
  }
  assertInventoryEvidence(value.remoteInventory)
  if (
    !isRecord(value.remoteInventory) ||
    typeof value.remoteInventory.paneKey !== 'string' ||
    typeof value.remoteInventory.tabId !== 'string' ||
    typeof value.remoteInventory.serializedPtyIncarnationId !== 'string' ||
    !Number.isSafeInteger(value.remoteInventory.serializedProcessId) ||
    Number(value.remoteInventory.serializedProcessId) <= 0 ||
    value.uniqueness.localCandidates !== 1 ||
    value.uniqueness.remoteCandidates !== 1 ||
    value.uniqueness.endpointIdentityMatched !== true ||
    value.uniqueness.processIdentityMatched !== true
  ) {
    throw new Error('legacy import one-to-one proof is invalid')
  }
}

export function assertPreservationFacts(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('legacy preservation facts are invalid')
  }
  if (value.kind === 'isolated-grace-disabled') {
    if (value.endpointIdentityRetained !== true || value.graceDisabledAcknowledged !== true) {
      throw new Error('legacy isolated preservation proof is invalid')
    }
    return
  }
  if (
    !['evidence-gc-retained', 'worker-unreachable', 'unsupported-platform'].includes(
      String(value.kind)
    ) ||
    value.processPreservationUnproved !== true
  ) {
    throw new Error('legacy unproved preservation facts are invalid')
  }
}

export function assertGcProtection(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('legacy worker GC protection is invalid')
  }
  assertPathList(value.relayDirectories, 'legacy GC relay directory')
  assertPathList(value.evidencePaths, 'legacy GC evidence path')
}

export function assertEndpointIdentity(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('legacy endpoint identity is invalid')
  }
  if (value.kind === 'unix-socket') {
    for (const selected of [value.device, value.inode, value.changedAtNs]) {
      if (typeof selected !== 'string' || !/^[0-9]+$/.test(selected)) {
        throw new Error('legacy Unix socket identity is invalid')
      }
    }
    return
  }
  if (value.kind !== 'windows-named-pipe') {
    throw new Error('legacy endpoint kind is invalid')
  }
  assertAuthorityStoragePath(value.pipeName, 'legacy pipeName')
  assertAuthorityId(value.processCreationMarker, 'legacy processCreationMarker')
}

export function assertPositiveInteger(value: unknown, field: string): void {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${field} is invalid`)
  }
}

export function assertTimestamp(value: unknown, field: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${field} is invalid`)
  }
}

function assertRecoveryBase(value: unknown): void {
  assertCandidateBase(value)
  if (!isRecord(value)) {
    return
  }
  assertTimestamp(value.discoveredAtMs, 'legacy recovery discoveredAtMs')
  assertTimestamp(value.updatedAtMs, 'legacy recovery updatedAtMs')
  if (Number(value.updatedAtMs) < Number(value.discoveredAtMs)) {
    throw new Error('legacy recovery timestamps are inconsistent')
  }
}

function assertWorkspaceEvidence(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('legacy workspace evidence is invalid')
  }
  assertTerminalAuthorityNamespaceLocator(value.locator as TerminalAuthorityNamespaceLocator)
  const locator = value.locator as TerminalAuthorityNamespaceLocator
  if (value.kind === 'git-worktree') {
    if (locator.kind !== 'workspace') {
      throw new Error('legacy git worktree locator is invalid')
    }
    assertAuthorityStoragePath(value.worktreeId, 'legacy worktreeId')
    return
  }
  if (value.kind === 'folder') {
    if (locator.kind !== 'workspace') {
      throw new Error('legacy folder locator is invalid')
    }
    return
  }
  if (value.kind !== 'floating' || locator.kind !== 'floating') {
    throw new Error('legacy workspace evidence flavor is invalid')
  }
}

function assertPhysicalPtyIdentity(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('legacy physical PTY identity is invalid')
  }
  assertAuthorityId(value.workerId, 'legacy PTY workerId')
  assertAuthorityId(value.physicalPtyId, 'legacy physicalPtyId')
  if (value.ptyIncarnationId !== null) {
    assertAuthorityId(value.ptyIncarnationId, 'legacy ptyIncarnationId')
  }
  if (value.processId !== null) {
    assertPositiveInteger(value.processId, 'legacy PTY processId')
  }
}

function assertInventoryEvidence(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('legacy inventory evidence is invalid')
  }
  assertAuthorityId(value.evidenceDigest, 'legacy inventory evidenceDigest')
  assertTimestamp(value.observedAtMs, 'legacy inventory observedAtMs')
  for (const [field, selected] of [
    ['paneKey', value.paneKey],
    ['tabId', value.tabId],
    ['worktreeId', value.worktreeId],
    ['cwd', value.cwd],
    ['serializedPtyIncarnationId', value.serializedPtyIncarnationId]
  ] as const) {
    if (selected === null) {
      continue
    }
    if (field === 'cwd' || field === 'worktreeId') {
      assertAuthorityStoragePath(selected, `legacy inventory ${field}`)
    } else {
      assertAuthorityId(selected, `legacy inventory ${field}`)
    }
  }
  if (value.serializedProcessId !== null) {
    assertPositiveInteger(value.serializedProcessId, 'legacy inventory serializedProcessId')
  }
}

function assertPathList(value: unknown, field: string): void {
  if (!Array.isArray(value) || value.length > MAX_GC_PATHS) {
    throw new Error(`${field} list is invalid`)
  }
  const paths = new Set<string>()
  for (const selected of value) {
    assertAuthorityStoragePath(selected, field)
    if (paths.has(selected)) {
      throw new Error(`${field} list contains a duplicate`)
    }
    paths.add(selected)
  }
}

const RECOVERY_REASONS = new Set<TerminalLegacyRecoveryReason>([
  'ambiguous-pane-generation',
  'endpoint-identity-unproved',
  'physical-pty-incarnation-unproved',
  'unsupported-platform',
  'worker-unreachable',
  'workspace-mismatch'
])

function isRecoveryReason(value: unknown): value is TerminalLegacyRecoveryReason {
  return typeof value === 'string' && RECOVERY_REASONS.has(value as TerminalLegacyRecoveryReason)
}
