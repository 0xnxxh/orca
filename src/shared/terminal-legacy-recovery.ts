import type {
  TerminalAuthorityNamespace,
  TerminalPaneGeneration,
  TerminalSessionBinding
} from './terminal-session-authority-identity'
import type { TerminalAuthorityNamespaceLocator } from './terminal-session-authority-locator'

export type TerminalLegacyWorkspaceEvidence =
  | Readonly<{
      kind: 'git-worktree'
      locator: Extract<TerminalAuthorityNamespaceLocator, { kind: 'workspace' }>
      worktreeId: string
    }>
  | Readonly<{
      kind: 'folder'
      locator: Extract<TerminalAuthorityNamespaceLocator, { kind: 'workspace' }>
    }>
  | Readonly<{
      kind: 'floating'
      locator: Extract<TerminalAuthorityNamespaceLocator, { kind: 'floating' }>
    }>

export type TerminalLegacyPhysicalPtyIdentity = Readonly<{
  workerId: string
  physicalPtyId: string
  ptyIncarnationId: string | null
  processId: number | null
}>

export type TerminalLegacyInventoryEvidence = Readonly<{
  evidenceDigest: string
  observedAtMs: number
  paneKey: string | null
  tabId: string | null
  worktreeId: string | null
  cwd: string | null
  serializedPtyIncarnationId: string | null
  serializedProcessId: number | null
}>

export type TerminalLegacyImportMatchEvidence = Readonly<{
  localLease: Readonly<{
    leaseId: string
    paneKey: string
    paneGenerationId: string
    rendererGeneration: number
    tabId: string
    worktreeId: string | null
  }>
  remoteInventory: TerminalLegacyInventoryEvidence &
    Readonly<{
      paneKey: string
      tabId: string
      serializedPtyIncarnationId: string
      serializedProcessId: number
    }>
  uniqueness: Readonly<{
    localCandidates: 1
    remoteCandidates: 1
    endpointIdentityMatched: true
    processIdentityMatched: true
  }>
}>

export type TerminalLegacyPreservationFacts =
  | Readonly<{
      kind: 'isolated-grace-disabled'
      endpointIdentityRetained: true
      graceDisabledAcknowledged: true
    }>
  | Readonly<{
      kind: 'evidence-gc-retained'
      processPreservationUnproved: true
    }>
  | Readonly<{
      kind: 'worker-unreachable'
      processPreservationUnproved: true
    }>
  | Readonly<{
      kind: 'unsupported-platform'
      processPreservationUnproved: true
    }>

export type TerminalLegacyRecoveryReason =
  | 'ambiguous-pane-generation'
  | 'endpoint-identity-unproved'
  | 'physical-pty-incarnation-unproved'
  | 'unsupported-platform'
  | 'worker-unreachable'
  | 'workspace-mismatch'

type TerminalLegacyRecoveryBase = Readonly<{
  recoveryId: string
  namespace: TerminalAuthorityNamespace
  workspace: TerminalLegacyWorkspaceEvidence
  physicalPty: TerminalLegacyPhysicalPtyIdentity
  inventoryEvidence: TerminalLegacyInventoryEvidence
  discoveredAtMs: number
  updatedAtMs: number
}>

export type TerminalLegacyImportedRecovery = TerminalLegacyRecoveryBase &
  Readonly<{
    status: 'imported'
    routeId: string
    pane: TerminalPaneGeneration
    binding: TerminalSessionBinding
    allocationId: string
    spawnFingerprint: string
    matchEvidence: TerminalLegacyImportMatchEvidence
    catalogReceiptId: string
    resolvedFrom: Readonly<{
      catalogReceiptId: string
      reason: TerminalLegacyRecoveryReason
      evidenceCode: string
    }> | null
  }>

export type TerminalLegacyUnresolvedRecovery = TerminalLegacyRecoveryBase &
  Readonly<{
    status: 'unresolved'
    reason: TerminalLegacyRecoveryReason
    evidenceCode: string
    preservation: TerminalLegacyPreservationFacts
    catalogReceiptId: string
  }>

export type TerminalLegacyAcknowledgedRecovery = TerminalLegacyRecoveryBase &
  Readonly<{
    status: 'acknowledged'
    reason: TerminalLegacyRecoveryReason
    evidenceCode: string
    preservation: TerminalLegacyPreservationFacts
    catalogReceiptId: string
    previousCatalogReceiptId: string
    acknowledgementCode: string
    acknowledgedAtMs: number
  }>

export type TerminalLegacyRecoveryProjection =
  | TerminalLegacyImportedRecovery
  | TerminalLegacyUnresolvedRecovery
  | TerminalLegacyAcknowledgedRecovery

export type TerminalLegacyImportCandidate = Readonly<{
  recoveryId: string
  namespace: TerminalAuthorityNamespace
  workspace: TerminalLegacyWorkspaceEvidence
  physicalPty: TerminalLegacyPhysicalPtyIdentity & Readonly<{ ptyIncarnationId: string }>
  pane: TerminalPaneGeneration
  allocationId: string
  spawnFingerprint: string
  inventoryEvidence: TerminalLegacyInventoryEvidence
  matchEvidence: TerminalLegacyImportMatchEvidence
}>

export type TerminalLegacyUnresolvedCandidate = Readonly<{
  recoveryId: string
  namespace: TerminalAuthorityNamespace
  workspace: TerminalLegacyWorkspaceEvidence
  physicalPty: TerminalLegacyPhysicalPtyIdentity
  reason: TerminalLegacyRecoveryReason
  evidenceCode: string
  inventoryEvidence: TerminalLegacyInventoryEvidence
  preservation: TerminalLegacyPreservationFacts
}>

type TerminalLegacyRecoveryNoticeBase = Readonly<{
  recoveryKey: string
  workspaceKind: TerminalLegacyWorkspaceEvidence['kind']
  evidenceDigest: string
  observedAtMs: number
  discoveredAtMs: number
  updatedAtMs: number
}>

export type TerminalLegacyRecoveryNotice = TerminalLegacyRecoveryNoticeBase &
  (
    | Readonly<{ status: 'imported' }>
    | Readonly<{
        status: 'unresolved' | 'acknowledged'
        reason: TerminalLegacyRecoveryReason
        preservationKind: TerminalLegacyPreservationFacts['kind']
      }>
  )
