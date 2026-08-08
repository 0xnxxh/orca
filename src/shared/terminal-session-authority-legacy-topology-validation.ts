import type {
  TerminalLegacyImportedRecovery,
  TerminalLegacyRecoveryProjection
} from './terminal-legacy-cutover'
import { sameTerminalBinding } from './terminal-session-authority-identity'
import { assertTerminalAuthorityLegacyTopologyAllowed } from './terminal-session-authority-legacy-mutation-fence'
import { failTerminalSessionAuthority } from './terminal-session-authority-mutation'
import type { TerminalSessionAuthorityTopology } from './terminal-session-authority-topology'

export function assertRestoredTerminalAuthorityLegacyTopology(
  recoveries: readonly TerminalLegacyRecoveryProjection[],
  topology: TerminalSessionAuthorityTopology,
  workerOwner: (workerId: string) => string | null
): void {
  assertTerminalAuthorityLegacyTopologyAllowed(
    recoveries.filter((row) => row.status === 'unresolved'),
    [],
    topology.paneSnapshot(),
    topology.allocationSnapshot(),
    workerOwner,
    'record-corrupt'
  )
  const imported = recoveries.filter(
    (row): row is TerminalLegacyImportedRecovery => row.status === 'imported'
  )
  const rowsByAllocation = new Map(imported.map((row) => [row.allocationId, row]))
  for (const allocation of topology.allocationSnapshot()) {
    if (allocation.intentActorId !== 'legacy-migration') {
      continue
    }
    const row = rowsByAllocation.get(allocation.allocationId)
    if (
      !row ||
      allocation.status !== 'committed' ||
      allocation.intentOperationId !== `${row.catalogReceiptId}:${row.recoveryId}` ||
      allocation.spawnFingerprint !== row.spawnFingerprint ||
      !sameTerminalBinding(allocation.binding, row.binding)
    ) {
      failTerminalSessionAuthority('record-corrupt', 'legacy allocation changed in snapshot')
    }
  }
  for (const row of imported) {
    const pane = topology.pane(row.pane)
    const allocation = topology.allocation(row.allocationId)
    if (
      (pane?.lastBinding && !sameTerminalBinding(pane.lastBinding, row.binding)) ||
      (allocation &&
        (allocation.status !== 'committed' ||
          allocation.intentActorId !== 'legacy-migration' ||
          !sameTerminalBinding(allocation.binding, row.binding)))
    ) {
      failTerminalSessionAuthority('record-corrupt', 'legacy topology changed in snapshot')
    }
  }
}
