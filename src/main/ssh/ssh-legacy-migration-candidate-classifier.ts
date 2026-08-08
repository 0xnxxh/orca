import type {
  TerminalLegacyImportCandidate,
  TerminalLegacyInventoryEvidence,
  TerminalLegacyRecoveryReason,
  TerminalLegacyUnresolvedCandidate
} from '../../shared/terminal-legacy-cutover'
import type { SshRemotePtyLease } from '../../shared/ssh-types'
import {
  canonicalEvidenceEqual,
  sshLegacyEvidenceDigest,
  sshLegacyEvidenceId,
  sshLegacyWorkspaceAndNamespaceEqual,
  sshLegacyWorkspaceWorktreeId
} from './ssh-legacy-migration-evidence-identity'
import {
  projectSshLegacyEndpointIdentity,
  projectSshLegacyProcessIdentity,
  projectSshLegacyRelayIdentityProof,
  projectSshLegacySourceEvidence
} from './ssh-legacy-migration-evidence-projection'
import type {
  SshLegacyInventoryGroup,
  SshLegacyInventoryIndexes,
  SshLegacyInventorySource
} from './ssh-legacy-migration-inventory-index'
import type {
  SshLegacyLayoutPaneEvidence,
  SshLegacyMigrationInventoryInput
} from './ssh-legacy-migration-inventory-types'

export type SshLegacyClassifiedCandidate =
  | Readonly<{ kind: 'import'; candidate: TerminalLegacyImportCandidate }>
  | Readonly<{ kind: 'unresolved'; candidate: TerminalLegacyUnresolvedCandidate }>

type ExactMatch = Readonly<{
  lease: SshRemotePtyLease
  localPane: SshLegacyLayoutPaneEvidence & {
    paneKey: string
    tabId: string
    leafId: string
    rendererGeneration: number
  }
  paneGenerationId: string
}>

export function classifySshLegacyInventoryGroup(
  input: SshLegacyMigrationInventoryInput,
  indexes: SshLegacyInventoryIndexes,
  group: SshLegacyInventoryGroup
): SshLegacyClassifiedCandidate {
  const source = group.sources[0]
  const groupDigest = sshLegacyEvidenceDigest(group.sources.map(projectSshLegacySourceEvidence))
  const inventoryEvidence = makeInventoryEvidence(source, groupDigest)
  const recoveryId = sshLegacyEvidenceId('ssh-legacy-recovery', [
    input.authorityHostId,
    group.workerId,
    group.physicalPtyId
  ])
  const physicalPty = Object.freeze({
    workerId: group.workerId,
    physicalPtyId: group.physicalPtyId,
    ptyIncarnationId: source.row.ptyIncarnationId,
    processId: source.row.processId
  })
  const reason = unresolvedReason(input, indexes, group, source)
  if (reason !== null) {
    return Object.freeze({
      kind: 'unresolved',
      candidate: Object.freeze({
        recoveryId,
        namespace: source.row.namespace,
        workspace: source.row.workspace,
        physicalPty,
        reason,
        evidenceCode: sshLegacyEvidenceId(`legacy-${reason}`, groupDigest),
        inventoryEvidence,
        preservation: Object.freeze({
          kind: 'evidence-gc-retained' as const,
          processPreservationUnproved: true as const
        })
      })
    })
  }

  const exact = exactMatch(indexes, group)
  const ptyIncarnationId = source.row.ptyIncarnationId as string
  const processId = source.row.processId as number
  const allocationId = sshLegacyEvidenceId('legacy-allocation', [
    recoveryId,
    exact.paneGenerationId
  ])
  const spawnFingerprint = sshLegacyEvidenceId('legacy-spawn', [
    source.relay.workerId,
    source.relay.buildId,
    source.row.physicalPtyId,
    ptyIncarnationId,
    processId,
    projectSshLegacyRelayIdentityProof(source.relay.identityProof)
  ])
  const remoteInventory = Object.freeze({
    ...inventoryEvidence,
    paneKey: source.row.serialized.paneKey as string,
    tabId: source.row.serialized.tabId as string,
    serializedPtyIncarnationId: source.row.serialized.ptyIncarnationId as string,
    serializedProcessId: source.row.serialized.processId as number
  })
  return Object.freeze({
    kind: 'import',
    candidate: Object.freeze({
      recoveryId,
      namespace: source.row.namespace,
      workspace: source.row.workspace,
      physicalPty: Object.freeze({ ...physicalPty, ptyIncarnationId }),
      pane: Object.freeze({
        paneKey: exact.localPane.paneKey,
        paneGenerationId: exact.paneGenerationId
      }),
      allocationId,
      spawnFingerprint,
      inventoryEvidence,
      matchEvidence: Object.freeze({
        localLease: Object.freeze({
          leaseId: sshLegacyEvidenceId(
            'legacy-lease',
            leaseIdentity(input.authorityHostId, group.physicalPtyId, exact.lease)
          ),
          paneKey: exact.localPane.paneKey,
          paneGenerationId: exact.paneGenerationId,
          rendererGeneration: exact.localPane.rendererGeneration,
          tabId: exact.localPane.tabId,
          worktreeId: sshLegacyWorkspaceWorktreeId(exact.localPane.workspace)
        }),
        remoteInventory,
        uniqueness: Object.freeze({
          localCandidates: 1 as const,
          remoteCandidates: 1 as const,
          endpointIdentityMatched: true as const,
          processIdentityMatched: true as const
        })
      })
    })
  })
}

function unresolvedReason(
  input: SshLegacyMigrationInventoryInput,
  indexes: SshLegacyInventoryIndexes,
  group: SshLegacyInventoryGroup,
  source: SshLegacyInventorySource
): TerminalLegacyRecoveryReason | null {
  if (group.sources.length !== 1) {
    return 'physical-pty-incarnation-unproved'
  }
  if (
    indexes.consumersFor(source.relay.workerId, source.relay.buildId).length !== 1 ||
    source.row.workerId !== source.relay.workerId ||
    source.row.buildId !== source.relay.buildId ||
    source.row.namespace.authorityHostId !== input.authorityHostId
  ) {
    return 'endpoint-identity-unproved'
  }
  if (
    source.row.ptyIncarnationId === null ||
    source.row.processId === null ||
    source.row.serialized.ptyIncarnationId !== source.row.ptyIncarnationId ||
    source.row.serialized.processId !== source.row.processId ||
    indexes.exactRemoteSourcesFor(source.row.physicalPtyId, source.row.ptyIncarnationId).length !==
      1
  ) {
    return 'physical-pty-incarnation-unproved'
  }
  const leases = indexes.leasesFor(group.physicalPtyId)
  if (leases.length !== 1 || leases[0].incarnationId !== source.row.ptyIncarnationId) {
    return 'physical-pty-incarnation-unproved'
  }
  const localPanes = indexes.localPanesFor(group.physicalPtyId)
  if (
    localPanes.length !== 1 ||
    !paneHasGeneration(localPanes[0]) ||
    leases[0].paneGeneration === undefined ||
    leases[0].paneGeneration !== localPanes[0].rendererGeneration
  ) {
    return 'ambiguous-pane-generation'
  }
  const snapshots = indexes.snapshotPanesFor(group.physicalPtyId)
  if (
    snapshots.length !== 1 ||
    !paneHasGeneration(snapshots[0]) ||
    !paneEvidenceMatches(localPanes[0], snapshots[0]) ||
    !paneMatchesLease(localPanes[0], leases[0]) ||
    !inventoryMatchesPane(source, localPanes[0])
  ) {
    return 'workspace-mismatch'
  }
  const proof = source.relay.identityProof
  if (
    proof.expectedEndpoint === null ||
    proof.observedEndpoint === null ||
    proof.expectedProcess === null ||
    proof.observedProcess === null ||
    !canonicalEvidenceEqual(
      projectSshLegacyEndpointIdentity(proof.expectedEndpoint),
      projectSshLegacyEndpointIdentity(proof.observedEndpoint)
    ) ||
    !canonicalEvidenceEqual(
      projectSshLegacyProcessIdentity(proof.expectedProcess),
      projectSshLegacyProcessIdentity(proof.observedProcess)
    )
  ) {
    return 'endpoint-identity-unproved'
  }
  return null
}

function exactMatch(
  indexes: SshLegacyInventoryIndexes,
  group: SshLegacyInventoryGroup
): ExactMatch {
  const lease = indexes.leasesFor(group.physicalPtyId)[0]
  const localPane = indexes.localPanesFor(group.physicalPtyId)[0] as ExactMatch['localPane']
  return Object.freeze({
    lease,
    localPane,
    paneGenerationId: `renderer:${localPane.rendererGeneration}`
  })
}

function paneHasGeneration(pane: SshLegacyLayoutPaneEvidence): pane is ExactMatch['localPane'] {
  return (
    pane.paneKey !== null &&
    pane.tabId !== null &&
    pane.leafId !== null &&
    pane.rendererGeneration !== null
  )
}

function paneEvidenceMatches(
  local: ExactMatch['localPane'],
  snapshot: ExactMatch['localPane']
): boolean {
  return (
    local.paneKey === snapshot.paneKey &&
    local.tabId === snapshot.tabId &&
    local.leafId === snapshot.leafId &&
    local.rendererGeneration === snapshot.rendererGeneration &&
    sshLegacyWorkspaceAndNamespaceEqual(local, snapshot)
  )
}

function paneMatchesLease(pane: ExactMatch['localPane'], lease: SshRemotePtyLease): boolean {
  return (
    lease.tabId === pane.tabId &&
    lease.leafId === pane.leafId &&
    (lease.worktreeId ?? null) === sshLegacyWorkspaceWorktreeId(pane.workspace)
  )
}

function inventoryMatchesPane(
  source: SshLegacyInventorySource,
  pane: ExactMatch['localPane']
): boolean {
  return (
    source.row.serialized.paneKey === pane.paneKey &&
    source.row.serialized.tabId === pane.tabId &&
    source.row.serialized.worktreeId === sshLegacyWorkspaceWorktreeId(pane.workspace) &&
    sshLegacyWorkspaceAndNamespaceEqual(source.row, pane)
  )
}

function makeInventoryEvidence(
  source: SshLegacyInventorySource,
  evidenceDigest: string
): TerminalLegacyInventoryEvidence {
  return Object.freeze({
    evidenceDigest,
    observedAtMs: source.relay.observedAtMs,
    paneKey: source.row.serialized.paneKey,
    tabId: source.row.serialized.tabId,
    worktreeId: source.row.serialized.worktreeId,
    cwd: source.row.serialized.cwd,
    serializedPtyIncarnationId: source.row.serialized.ptyIncarnationId,
    serializedProcessId: source.row.serialized.processId
  })
}

function leaseIdentity(
  authorityHostId: string,
  physicalPtyId: string,
  lease: SshRemotePtyLease
): readonly unknown[] {
  return [
    authorityHostId,
    physicalPtyId,
    lease.incarnationId ?? null,
    lease.worktreeId ?? null,
    lease.tabId ?? null,
    lease.leafId ?? null,
    lease.paneGeneration ?? null
  ]
}
