import type { TerminalLegacyRecoveryReason } from '../../shared/terminal-legacy-cutover'
import { classifySshLegacyInventoryGroup } from './ssh-legacy-migration-candidate-classifier'
import {
  canonicalEvidenceSort,
  compareSshLegacyText,
  sshLegacyEvidenceDigest,
  sshLegacyEvidenceId
} from './ssh-legacy-migration-evidence-identity'
import { assertSshLegacyMigrationInventoryCapacity } from './ssh-legacy-migration-inventory-capacity'
import {
  indexSshLegacyMigrationInventory,
  sshLegacyScopedEvidence
} from './ssh-legacy-migration-inventory-index'
import { classifySshLegacyLeaseWithoutInventory } from './ssh-legacy-migration-missing-inventory-classifier'
import type {
  SshLegacyMigrationInventoryInput,
  SshLegacyMigrationInventoryPlan
} from './ssh-legacy-migration-inventory-types'
import { assertSshLegacyMigrationInventoryInput } from './ssh-legacy-migration-inventory-validation'

export function planSshLegacyMigrationInventory(
  input: SshLegacyMigrationInventoryInput
): SshLegacyMigrationInventoryPlan {
  assertSshLegacyMigrationInventoryCapacity(input)
  assertSshLegacyMigrationInventoryInput(input)

  const indexes = indexSshLegacyMigrationInventory(input)
  const evidenceDigest = sshLegacyEvidenceDigest(sshLegacyScopedEvidence(input))
  const migrationId = sshLegacyEvidenceId('ssh-legacy-migration', [
    input.authorityHostId,
    evidenceDigest
  ])
  const classified = indexes.groups.map((group) =>
    classifySshLegacyInventoryGroup(input, indexes, group)
  )
  const leasesWithoutInventory = indexes.leasesWithoutInventory
    .map((group) => classifySshLegacyLeaseWithoutInventory(input, indexes, group))
    .filter((candidate) => candidate !== null)
  const imports = canonicalEvidenceSort(
    classified.filter((row) => row.kind === 'import').map((row) => row.candidate)
  )
  const unresolved = canonicalEvidenceSort([
    ...classified.filter((row) => row.kind === 'unresolved').map((row) => row.candidate),
    ...leasesWithoutInventory
  ])
  imports.sort((left, right) => compareSshLegacyText(left.recoveryId, right.recoveryId))
  unresolved.sort((left, right) => compareSshLegacyText(left.recoveryId, right.recoveryId))
  const unresolvedReasons = countUnresolvedReasons(unresolved.map((row) => row.reason))
  const summary = Object.freeze({
    evidenceDigest,
    migrationId,
    relayCount: indexes.relayCount,
    inventoryRowCount: indexes.inventoryRowCount,
    importCount: imports.length,
    unresolvedCount: unresolved.length,
    unresolvedReasons
  })

  return Object.freeze({
    evidenceDigest,
    migrationId,
    imports: Object.freeze(imports),
    unresolved: Object.freeze(unresolved),
    summary
  })
}

function countUnresolvedReasons(
  reasons: readonly TerminalLegacyRecoveryReason[]
): readonly Readonly<{ reason: TerminalLegacyRecoveryReason; count: number }>[] {
  const counts = new Map<TerminalLegacyRecoveryReason, number>()
  for (const reason of reasons) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  return Object.freeze(
    [...counts.entries()]
      .sort(([left], [right]) => compareSshLegacyText(left, right))
      .map(([reason, count]) => Object.freeze({ reason, count }))
  )
}

export type {
  SshLegacyLayoutPaneEvidence,
  SshLegacyLiveRelayInventory,
  SshLegacyMigrationInventoryInput,
  SshLegacyMigrationInventoryPlan,
  SshLegacyPersistedConsumerEvidence,
  SshLegacyRelayInventoryRow,
  SshLegacyRemoteSnapshotPaneEvidence
} from './ssh-legacy-migration-inventory-types'
export {
  SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY,
  SshLegacyMigrationInventoryCapacityError
} from './ssh-legacy-migration-inventory-capacity'
