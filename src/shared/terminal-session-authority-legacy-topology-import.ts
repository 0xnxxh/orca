import { terminalPaneGenerationKey } from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalPaneAuthorityRecord,
  type TerminalSessionPtyAllocation
} from './terminal-session-authority-mutation'
import { terminalAuthorityPhysicalPtyKey } from './terminal-session-authority-transition'
import type { TerminalLegacyImportedRecovery } from './terminal-legacy-cutover'

type TerminalAuthorityLegacyImportIndexes = Readonly<{
  paneGenerations: ReadonlyMap<string, unknown>
  paneKeys: ReadonlyMap<string, unknown>
  allocationIds: ReadonlyMap<string, unknown>
  physicalPtys: ReadonlyMap<string, unknown>
  maxPaneRecords: number
}>

export function planTerminalAuthorityLegacyTopologyImport(
  rows: readonly TerminalLegacyImportedRecovery[],
  receiptId: string,
  revision: number,
  indexes: TerminalAuthorityLegacyImportIndexes
): Readonly<{
  panes: readonly TerminalPaneAuthorityRecord[]
  allocations: readonly TerminalSessionPtyAllocation[]
}> {
  assertLegacyRowsDoNotConflict(rows, indexes)
  const newPaneKeys = new Set(rows.map((row) => row.pane.paneKey))
  if (indexes.paneKeys.size + newPaneKeys.size > indexes.maxPaneRecords) {
    failTerminalSessionAuthority('capacity', 'legacy import panes exceed retention capacity')
  }
  return Object.freeze({
    panes: Object.freeze(
      rows.map((row) =>
        Object.freeze({
          ...row.pane,
          status: 'open' as const,
          binding: row.binding,
          lastBinding: row.binding,
          revision
        })
      )
    ),
    allocations: Object.freeze(
      rows.map((row) =>
        Object.freeze({
          allocationId: row.allocationId,
          pane: row.pane,
          ownerIncarnationId: row.binding.ownerIncarnationId,
          physicalPtyId: row.binding.physicalPtyId,
          spawnFingerprint: row.spawnFingerprint,
          intentActorId: 'legacy-migration',
          intentOperationId: `${receiptId}:${row.recoveryId}`,
          preparedAtRevision: revision,
          status: 'committed' as const,
          binding: row.binding,
          committedAtRevision: revision
        })
      )
    )
  })
}

function assertLegacyRowsDoNotConflict(
  rows: readonly TerminalLegacyImportedRecovery[],
  indexes: TerminalAuthorityLegacyImportIndexes
): void {
  const paneKeys = new Set<string>()
  const allocationIds = new Set<string>()
  const physicalPtys = new Set<string>()
  for (const row of rows) {
    const paneKey = terminalPaneGenerationKey(row.pane)
    const physicalKey = terminalAuthorityPhysicalPtyKey(
      row.binding.ownerIncarnationId,
      row.physicalPty.physicalPtyId
    )
    if (
      indexes.paneGenerations.has(paneKey) ||
      indexes.paneKeys.has(row.pane.paneKey) ||
      indexes.allocationIds.has(row.allocationId) ||
      indexes.physicalPtys.has(physicalKey) ||
      paneKeys.has(paneKey) ||
      allocationIds.has(row.allocationId) ||
      physicalPtys.has(physicalKey)
    ) {
      failTerminalSessionAuthority('allocation-conflict', 'legacy import conflicts')
    }
    paneKeys.add(paneKey)
    allocationIds.add(row.allocationId)
    physicalPtys.add(physicalKey)
  }
}
