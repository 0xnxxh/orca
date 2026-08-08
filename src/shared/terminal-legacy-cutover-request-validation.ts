import {
  assertAuthorityId,
  assertAuthorityStoragePath,
  assertPaneGeneration,
  isRecord,
  type TerminalPaneGeneration
} from './terminal-session-authority-identity'
import {
  assertCandidateBase,
  assertEndpointIdentity,
  assertGcProtection,
  assertImportMatchEvidence,
  assertPositiveInteger,
  assertPreservationFacts,
  assertTerminalLegacyRecoveryProjection,
  assertTimestamp
} from './terminal-legacy-cutover-recovery-validation'
import {
  TERMINAL_LEGACY_CUTOVER_VERSION,
  type TerminalLegacyEndpointIdentity,
  type TerminalLegacyImportMatchEvidence,
  type TerminalLegacyMigrationImportRequest,
  type TerminalLegacyMigrationReceipt,
  type TerminalLegacyPhysicalPtyIdentity,
  type TerminalLegacyUnresolvedCandidate,
  type TerminalLegacyWorkerEvidence,
  type TerminalLegacyWorkerRoute
} from './terminal-legacy-cutover'

const MAX_MIGRATION_CANDIDATES = 4_096

export function assertTerminalLegacyMigrationReceipt(
  value: unknown
): asserts value is TerminalLegacyMigrationReceipt {
  if (
    !isRecord(value) ||
    value.version !== TERMINAL_LEGACY_CUTOVER_VERSION ||
    !isRecord(value.request) ||
    value.receiptId !== value.request.migrationId ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    !Number.isSafeInteger(value.committedAtMs) ||
    Number(value.committedAtMs) < 0 ||
    !Array.isArray(value.recoveries)
  ) {
    throw new Error('legacy migration receipt is invalid')
  }
  assertTerminalLegacyMigrationImportRequest(value.request)
  for (const recovery of value.recoveries) {
    assertTerminalLegacyRecoveryProjection(recovery)
  }
}

export function assertTerminalLegacyMigrationImportRequest(
  value: unknown
): asserts value is TerminalLegacyMigrationImportRequest {
  if (!isRecord(value) || value.version !== TERMINAL_LEGACY_CUTOVER_VERSION) {
    throw new Error('legacy migration request version is invalid')
  }
  assertAuthorityId(value.migrationId, 'legacy migrationId')
  assertAuthorityId(value.authorityHostId, 'legacy authorityHostId')
  assertTimestamp(value.requestedAtMs, 'legacy migration requestedAtMs')
  if (!Array.isArray(value.imports) || !Array.isArray(value.unresolved)) {
    throw new Error('legacy migration candidates are invalid')
  }
  const candidateCount = value.imports.length + value.unresolved.length
  if (
    candidateCount > MAX_MIGRATION_CANDIDATES ||
    (value.mode !== 'acknowledge' && candidateCount < 1)
  ) {
    throw new Error('legacy migration candidates exceed their bounded capacity')
  }
  assertMigrationMode(value)
  for (const candidate of value.imports) {
    assertImportCandidate(candidate)
  }
  for (const candidate of value.unresolved) {
    assertUnresolvedCandidate(candidate)
    assertCandidatePreservation(value.mode, candidate as TerminalLegacyUnresolvedCandidate)
  }
}

export function assertTerminalLegacyWorkerEvidence(
  value: unknown
): asserts value is TerminalLegacyWorkerEvidence {
  if (!isRecord(value)) {
    throw new Error('legacy worker evidence is invalid')
  }
  assertAuthorityId(value.workerId, 'legacy evidence workerId')
  if (value.buildId !== null) {
    assertAuthorityId(value.buildId, 'legacy evidence buildId')
  }
  assertAuthorityStoragePath(value.relayDirectory, 'legacy evidence relayDirectory')
  assertAuthorityStoragePath(value.endpointPath, 'legacy evidence endpointPath')
  assertAuthorityStoragePath(value.credentialFile, 'legacy evidence credentialFile')
  if (value.process !== null) {
    if (!isRecord(value.process)) {
      throw new Error('legacy evidence process is invalid')
    }
    assertPositiveInteger(value.process.pid, 'legacy evidence pid')
    assertAuthorityId(value.process.birthMarker, 'legacy evidence birthMarker')
  }
  assertAuthorityId(value.inventoryDigest, 'legacy evidence inventoryDigest')
  assertGcProtection(value.gcProtection)
}

export function assertTerminalLegacyWorkerRoute(
  value: unknown
): asserts value is TerminalLegacyWorkerRoute {
  if (!isRecord(value) || !isRecord(value.process) || !isRecord(value.sourceOwner)) {
    throw new Error('legacy worker route is invalid')
  }
  for (const [field, selected] of [
    ['routeId', value.routeId],
    ['workerId', value.workerId],
    ['ownerIncarnationId', value.ownerIncarnationId],
    ['buildId', value.buildId]
  ] as const) {
    assertAuthorityId(selected, `legacy worker ${field}`)
  }
  assertAuthorityStoragePath(value.relayDirectory, 'legacy worker relayDirectory')
  assertAuthorityStoragePath(value.socketPath, 'legacy worker socketPath')
  assertAuthorityStoragePath(value.credentialFile, 'legacy worker credentialFile')
  assertPositiveInteger(value.process.pid, 'legacy worker pid')
  assertAuthorityId(value.process.birthMarker, 'legacy worker birthMarker')
  assertEndpointIdentity(value.endpoint)
  assertAuthorityId(value.sourceOwner.clientInstanceId, 'legacy source clientInstanceId')
  assertPositiveInteger(value.sourceOwner.ownerGeneration, 'legacy source ownerGeneration')
  assertAuthorityId(value.sourceOwner.ownerLease, 'legacy source ownerLease')
  assertPositiveInteger(
    value.sourceOwner.outputWindowSourceUnits,
    'legacy source outputWindowSourceUnits'
  )
  assertGcProtection(value.gcProtection)
}

function assertMigrationMode(value: Record<string, unknown>): void {
  if (value.mode === 'cutover') {
    assertTerminalLegacyWorkerRoute(value.workerRoute)
    assertTerminalLegacyCutoverProof(value.cutover)
    return
  }
  if (value.mode === 'recovery-only') {
    assertTerminalLegacyWorkerEvidence(value.workerEvidence)
    if ((value.imports as unknown[]).length !== 0) {
      throw new Error('recovery-only migration cannot import a PTY')
    }
    return
  }
  if (value.mode !== 'acknowledge') {
    throw new Error('legacy migration mode is invalid')
  }
  assertAuthorityId(value.recoveryId, 'legacy acknowledged recoveryId')
  assertAuthorityId(value.expectedCatalogReceiptId, 'legacy expectedCatalogReceiptId')
  assertAuthorityId(value.acknowledgementCode, 'legacy acknowledgementCode')
  if ((value.imports as unknown[]).length !== 0 || (value.unresolved as unknown[]).length !== 0) {
    throw new Error('legacy acknowledgement cannot carry candidates')
  }
}

function assertCandidatePreservation(
  mode: unknown,
  candidate: TerminalLegacyUnresolvedCandidate
): void {
  if (mode === 'recovery-only' && candidate.preservation.kind === 'isolated-grace-disabled') {
    throw new Error('recovery-only migration cannot claim worker isolation')
  }
  if (mode === 'cutover' && candidate.preservation.kind !== 'isolated-grace-disabled') {
    throw new Error('cutover recovery must retain the isolated worker')
  }
}

function assertImportCandidate(value: unknown): void {
  assertCandidateBase(value)
  if (!isRecord(value)) {
    return
  }
  assertPaneGeneration(value.pane)
  assertAuthorityId(value.allocationId, 'legacy allocationId')
  assertAuthorityId(value.spawnFingerprint, 'legacy spawnFingerprint')
  assertImportMatchEvidence(value.matchEvidence)
  if (!isRecord(value.physicalPty) || typeof value.physicalPty.ptyIncarnationId !== 'string') {
    throw new Error('legacy import requires an exact PTY incarnation')
  }
  const match = value.matchEvidence as TerminalLegacyImportMatchEvidence
  const physical = value.physicalPty as TerminalLegacyPhysicalPtyIdentity
  const pane = value.pane as TerminalPaneGeneration
  if (
    match.localLease.paneKey !== pane.paneKey ||
    match.localLease.paneGenerationId !== pane.paneGenerationId ||
    match.remoteInventory.paneKey !== match.localLease.paneKey ||
    match.remoteInventory.tabId !== match.localLease.tabId ||
    match.remoteInventory.serializedPtyIncarnationId !== physical.ptyIncarnationId ||
    match.remoteInventory.serializedProcessId !== physical.processId
  ) {
    throw new Error('legacy import evidence does not match the derived binding')
  }
}

function assertUnresolvedCandidate(value: unknown): void {
  assertCandidateBase(value)
  if (!isRecord(value) || !RECOVERY_REASONS.has(String(value.reason))) {
    throw new Error('legacy unresolved reason is invalid')
  }
  assertAuthorityId(value.evidenceCode, 'legacy unresolved evidenceCode')
  assertPreservationFacts(value.preservation)
}

function assertTerminalLegacyCutoverProof(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('legacy cutover proof is invalid')
  }
  assertAuthorityStoragePath(value.publicCredentialFile, 'legacy cutover publicCredentialFile')
  assertAuthorityStoragePath(value.privateCredentialFile, 'legacy cutover privateCredentialFile')
  assertCutoverEndpoint(value)
  if (value.brokerClientCount !== 1) {
    throw new Error('legacy cutover broker client count is invalid')
  }
  assertPositiveInteger(value.acceptedConnectionCount, 'legacy acceptedConnectionCount')
  if (!Number.isSafeInteger(value.quiescenceSamples) || Number(value.quiescenceSamples) < 2) {
    throw new Error('legacy quiescenceSamples is invalid')
  }
  if (
    !isRecord(value.connectionProof) ||
    !CONNECTION_PROOF_METHODS.has(String(value.connectionProof.method)) ||
    value.connectionProof.acceptedServerConnections !== 1
  ) {
    throw new Error('legacy broker connection proof is invalid')
  }
  assertAuthorityId(value.connectionProof.listenerIdentity, 'legacy listenerIdentity')
  assertAuthorityId(
    value.connectionProof.brokerConnectionIdentity,
    'legacy brokerConnectionIdentity'
  )
  if (
    !isRecord(value.graceConfiguration) ||
    value.graceConfiguration.capabilityVersion !== 1 ||
    value.graceConfiguration.configuredGraceMs !== 0 ||
    value.graceConfiguration.acknowledged !== true
  ) {
    throw new Error('legacy cutover grace configuration is invalid')
  }
  assertTimestamp(value.sealedAtMs, 'legacy cutover sealedAtMs')
}

function assertCutoverEndpoint(value: Record<string, unknown>): void {
  if (value.kind === 'posix-relocated') {
    assertAuthorityStoragePath(value.publicSocketPath, 'legacy cutover publicSocketPath')
    assertAuthorityStoragePath(value.privateSocketPath, 'legacy cutover privateSocketPath')
    assertEndpointIdentity(value.endpointIdentity)
    if ((value.endpointIdentity as TerminalLegacyEndpointIdentity).kind !== 'unix-socket') {
      throw new Error('legacy POSIX endpoint proof is invalid')
    }
    return
  }
  if (value.kind !== 'windows-sealed') {
    throw new Error('legacy cutover proof kind is invalid')
  }
  assertAuthorityStoragePath(value.originalPipeName, 'legacy cutover originalPipeName')
  if (value.activePipeMarkerIgnored !== true) {
    throw new Error('legacy Windows active pipe marker is not fenced')
  }
  assertEndpointIdentity(value.endpointIdentity)
  if ((value.endpointIdentity as TerminalLegacyEndpointIdentity).kind !== 'windows-named-pipe') {
    throw new Error('legacy Windows endpoint proof is invalid')
  }
}

const RECOVERY_REASONS = new Set([
  'ambiguous-pane-generation',
  'endpoint-identity-unproved',
  'physical-pty-incarnation-unproved',
  'unsupported-platform',
  'worker-unreachable',
  'workspace-mismatch'
])

const CONNECTION_PROOF_METHODS = new Set([
  'linux-procfs-unix',
  'darwin-lsof-unix',
  'windows-pipe-process'
])
