import type {
  TerminalLegacyImportCandidate,
  TerminalLegacyRecoveryNotice,
  TerminalLegacyRecoveryProjection,
  TerminalLegacyUnresolvedCandidate
} from './terminal-legacy-recovery'

export const TERMINAL_LEGACY_CUTOVER_VERSION = 1
export const TERMINAL_LEGACY_CUTOVER_CAPABILITY = 'terminal-session.legacy-cutover.v1'

export function relayDaemonGrantHasTerminalLegacyCutover(
  capabilities: readonly string[] | undefined
): boolean {
  return capabilities?.includes(TERMINAL_LEGACY_CUTOVER_CAPABILITY) === true
}

export type TerminalLegacyProcessIdentity = Readonly<{
  pid: number
  birthMarker: string
}>

export type TerminalLegacyEndpointIdentity =
  | Readonly<{
      kind: 'unix-socket'
      device: string
      inode: string
      changedAtNs: string
    }>
  | Readonly<{
      kind: 'windows-named-pipe'
      pipeName: string
      processCreationMarker: string
    }>

export type TerminalLegacySourceOwner = Readonly<{
  clientInstanceId: string
  ownerGeneration: number
  ownerLease: string
  outputWindowSourceUnits: number
}>

export type TerminalLegacyWorkerRoute = Readonly<{
  routeId: string
  workerId: string
  ownerIncarnationId: string
  buildId: string
  relayDirectory: string
  socketPath: string
  credentialFile: string
  process: TerminalLegacyProcessIdentity
  endpoint: TerminalLegacyEndpointIdentity
  sourceOwner: TerminalLegacySourceOwner
  gcProtection: TerminalLegacyGcProtection
}>

export type TerminalLegacyGcProtection = Readonly<{
  relayDirectories: readonly string[]
  evidencePaths: readonly string[]
}>

export type TerminalLegacyWorkerEvidence = Readonly<{
  workerId: string
  buildId: string | null
  relayDirectory: string
  endpointPath: string
  credentialFile: string
  process: TerminalLegacyProcessIdentity | null
  inventoryDigest: string
  gcProtection: TerminalLegacyGcProtection
}>

type TerminalLegacyCutoverProofBase = Readonly<{
  publicCredentialFile: string
  privateCredentialFile: string
  brokerClientCount: 1
  acceptedConnectionCount: number
  quiescenceSamples: number
  connectionProof: Readonly<{
    method: 'linux-procfs-unix' | 'darwin-lsof-unix' | 'windows-pipe-process'
    listenerIdentity: string
    brokerConnectionIdentity: string
    acceptedServerConnections: 1
  }>
  graceConfiguration: Readonly<{
    capabilityVersion: 1
    configuredGraceMs: 0
    acknowledged: true
  }>
  sealedAtMs: number
}>

export type TerminalLegacyCutoverProof = TerminalLegacyCutoverProofBase &
  (
    | Readonly<{
        kind: 'posix-relocated'
        publicSocketPath: string
        privateSocketPath: string
        endpointIdentity: Extract<TerminalLegacyEndpointIdentity, { kind: 'unix-socket' }>
      }>
    | Readonly<{
        kind: 'windows-sealed'
        originalPipeName: string
        activePipeMarkerIgnored: true
        endpointIdentity: Extract<TerminalLegacyEndpointIdentity, { kind: 'windows-named-pipe' }>
      }>
  )

type TerminalLegacyMigrationRequestBase = Readonly<{
  version: typeof TERMINAL_LEGACY_CUTOVER_VERSION
  migrationId: string
  authorityHostId: string
  requestedAtMs: number
}>

export type TerminalLegacyMigrationImportRequest = TerminalLegacyMigrationRequestBase &
  (
    | Readonly<{
        mode: 'cutover'
        workerRoute: TerminalLegacyWorkerRoute
        cutover: TerminalLegacyCutoverProof
        imports: readonly TerminalLegacyImportCandidate[]
        unresolved: readonly TerminalLegacyUnresolvedCandidate[]
      }>
    | Readonly<{
        mode: 'recovery-only'
        workerEvidence: TerminalLegacyWorkerEvidence
        imports: readonly []
        unresolved: readonly TerminalLegacyUnresolvedCandidate[]
      }>
    | Readonly<{
        mode: 'acknowledge'
        recoveryId: string
        expectedCatalogReceiptId: string
        acknowledgementCode: string
        imports: readonly []
        unresolved: readonly []
      }>
  )

export type TerminalLegacyMigrationReceipt = Readonly<{
  version: typeof TERMINAL_LEGACY_CUTOVER_VERSION
  receiptId: string
  sequence: number
  committedAtMs: number
  request: TerminalLegacyMigrationImportRequest
  recoveries: readonly TerminalLegacyRecoveryProjection[]
}>

export type TerminalLegacyCutoverProjection = Readonly<{
  version: typeof TERMINAL_LEGACY_CUTOVER_VERSION
  revision: number
  workers: readonly TerminalLegacyWorkerRouteProjection[]
  recoveries: readonly TerminalLegacyRecoveryView[]
}>

export type TerminalLegacyWorkerRouteProjection = Readonly<{
  routeId: string
  workerId: string
  ownerIncarnationId: string
  buildId: string
  process: TerminalLegacyProcessIdentity
  endpoint:
    | Extract<TerminalLegacyEndpointIdentity, { kind: 'unix-socket' }>
    | Readonly<{
        kind: 'windows-named-pipe'
        processCreationMarker: string
      }>
  sourceOwner: Omit<TerminalLegacySourceOwner, 'ownerLease'>
}>

export type TerminalLegacyRecoveryView = TerminalLegacyRecoveryProjection &
  Readonly<{
    workerRoute: TerminalLegacyWorkerRouteProjection | null
  }>

export type TerminalLegacyRecoveryNoticeProjection = Readonly<{
  version: typeof TERMINAL_LEGACY_CUTOVER_VERSION
  revision: number
  notices: readonly TerminalLegacyRecoveryNotice[]
}>

export type {
  TerminalLegacyAcknowledgedRecovery,
  TerminalLegacyImportCandidate,
  TerminalLegacyImportMatchEvidence,
  TerminalLegacyImportedRecovery,
  TerminalLegacyInventoryEvidence,
  TerminalLegacyPhysicalPtyIdentity,
  TerminalLegacyPreservationFacts,
  TerminalLegacyRecoveryNotice,
  TerminalLegacyRecoveryProjection,
  TerminalLegacyRecoveryReason,
  TerminalLegacyUnresolvedCandidate,
  TerminalLegacyUnresolvedRecovery,
  TerminalLegacyWorkspaceEvidence
} from './terminal-legacy-recovery'
