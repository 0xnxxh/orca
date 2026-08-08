import {
  TERMINAL_AUTHORITY_TOPOLOGY_MAX_CHANGE_OPERATIONS,
  type TerminalAuthorityTopologyPaneChange
} from '../shared/terminal-authority-topology-stream-contract'
import type { TerminalLegacyRecoveryNoticeProjection } from '../shared/terminal-legacy-cutover'

export type TerminalAuthorityTopologyChangeBatch = Readonly<{
  paneChanges: readonly TerminalAuthorityTopologyPaneChange[]
  recoveryNotices?: TerminalLegacyRecoveryNoticeProjection
}>

type BatchFits = (
  batchIndex: number,
  paneChanges: readonly TerminalAuthorityTopologyPaneChange[],
  recoveryNotices?: TerminalLegacyRecoveryNoticeProjection
) => boolean

export function createTerminalAuthorityTopologyChangePlan(
  groups: readonly (readonly TerminalAuthorityTopologyPaneChange[])[],
  recoveryNotices: TerminalLegacyRecoveryNoticeProjection | null,
  batchFits: BatchFits
): readonly TerminalAuthorityTopologyChangeBatch[] | null {
  const batches: TerminalAuthorityTopologyChangeBatch[] = []
  let pending: TerminalAuthorityTopologyPaneChange[] = []
  for (const group of groups) {
    if (group.length > TERMINAL_AUTHORITY_TOPOLOGY_MAX_CHANGE_OPERATIONS) {
      return null
    }
    const candidate = [...pending, ...group]
    if (
      candidate.length <= TERMINAL_AUTHORITY_TOPOLOGY_MAX_CHANGE_OPERATIONS &&
      batchFits(batches.length, candidate)
    ) {
      pending = candidate
      continue
    }
    if (pending.length === 0) {
      return null
    }
    batches.push(Object.freeze({ paneChanges: Object.freeze(pending) }))
    pending = [...group]
    if (!batchFits(batches.length, pending)) {
      return null
    }
  }
  if (pending.length > 0) {
    batches.push(Object.freeze({ paneChanges: Object.freeze(pending) }))
  }
  if (!recoveryNotices) {
    return Object.freeze(batches)
  }
  const finalIndex = Math.max(0, batches.length - 1)
  const finalPaneChanges = batches[finalIndex]?.paneChanges ?? []
  if (batchFits(finalIndex, finalPaneChanges, recoveryNotices)) {
    const withRecovery = Object.freeze({ paneChanges: finalPaneChanges, recoveryNotices })
    if (batches.length === 0) {
      batches.push(withRecovery)
    } else {
      batches[finalIndex] = withRecovery
    }
    return Object.freeze(batches)
  }
  if (!batchFits(batches.length, [], recoveryNotices)) {
    return null
  }
  batches.push(Object.freeze({ paneChanges: Object.freeze([]), recoveryNotices }))
  return Object.freeze(batches)
}

export function terminalAuthorityTopologyGapSignalBatch(
  batches: readonly TerminalAuthorityTopologyChangeBatch[]
): TerminalAuthorityTopologyChangeBatch {
  const first = batches[0]
  if (!first) {
    throw new Error('terminal_authority_topology_change_plan_empty')
  }
  const paneChange = first.paneChanges[0]
  return paneChange ? Object.freeze({ paneChanges: Object.freeze([paneChange]) }) : first
}
