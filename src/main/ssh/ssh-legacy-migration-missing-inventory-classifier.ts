import type {
  TerminalLegacyInventoryEvidence,
  TerminalLegacyUnresolvedCandidate
} from '../../shared/terminal-legacy-cutover'
import {
  sshLegacyEvidenceDigest,
  sshLegacyEvidenceId,
  sshLegacyWorkspaceWorktreeId
} from './ssh-legacy-migration-evidence-identity'
import {
  sshLegacyScopedEvidence,
  type SshLegacyInventoryIndexes,
  type SshLegacyLeaseWithoutInventory
} from './ssh-legacy-migration-inventory-index'
import type { SshLegacyMigrationInventoryInput } from './ssh-legacy-migration-inventory-types'

export function classifySshLegacyLeaseWithoutInventory(
  input: SshLegacyMigrationInventoryInput,
  indexes: SshLegacyInventoryIndexes,
  group: SshLegacyLeaseWithoutInventory
): TerminalLegacyUnresolvedCandidate | null {
  const relays = indexes.consumers.flatMap((consumer) => {
    if (indexes.consumersFor(consumer.workerId, consumer.serverBuildId).length !== 1) {
      return []
    }
    return indexes
      .relaysForBuild(consumer.serverBuildId)
      .filter((relay) => relay.workerId === consumer.workerId)
  })
  if (relays.length !== 1) {
    return null
  }
  const localPanes = indexes.localPanesFor(group.physicalPtyId)
  const snapshotPanes = indexes.snapshotPanesFor(group.physicalPtyId)
  const pane = localPanes[0] ?? snapshotPanes[0]
  if (!pane) {
    return null
  }

  const relay = relays[0]
  const lease = group.leases[0]
  const evidenceDigest = sshLegacyEvidenceDigest({
    kind: 'missing-remote-inventory-row',
    authorityHostId: input.authorityHostId,
    workerId: relay.workerId,
    buildId: relay.buildId,
    physicalPtyId: group.physicalPtyId,
    scopedEvidence: sshLegacyScopedEvidence(input)
  })
  const recoveryId = sshLegacyEvidenceId('ssh-legacy-recovery', [
    input.authorityHostId,
    relay.workerId,
    group.physicalPtyId
  ])
  const inventoryEvidence: TerminalLegacyInventoryEvidence = Object.freeze({
    evidenceDigest,
    observedAtMs: relay.observedAtMs,
    paneKey: pane.paneKey,
    tabId: pane.tabId,
    worktreeId: sshLegacyWorkspaceWorktreeId(pane.workspace),
    cwd: null,
    serializedPtyIncarnationId: null,
    serializedProcessId: null
  })

  return Object.freeze({
    recoveryId,
    namespace: pane.namespace,
    workspace: pane.workspace,
    physicalPty: Object.freeze({
      workerId: relay.workerId,
      physicalPtyId: group.physicalPtyId,
      ptyIncarnationId: lease.incarnationId ?? null,
      processId: null
    }),
    reason: 'physical-pty-incarnation-unproved',
    evidenceCode: sshLegacyEvidenceId('legacy-physical-pty-incarnation-unproved', evidenceDigest),
    inventoryEvidence,
    preservation: Object.freeze({
      kind: 'evidence-gc-retained' as const,
      processPreservationUnproved: true as const
    })
  })
}
