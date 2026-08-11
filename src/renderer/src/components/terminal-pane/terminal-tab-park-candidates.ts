/**
 * Builds the per-tab cold-park candidate list for useTerminalTabColdParking.
 *
 * Why separate: the hidden-clock and activation-order bookkeeping that decides
 * each candidate's park rank is policy, not hook orchestration.
 */
import type { TerminalTab } from '../../../../shared/types'
import type { TerminalTabColdParkCandidate } from './terminal-hidden-view-parking'
import type { TerminalTabActivationOrder } from './terminal-tab-activation-order'

export function buildTerminalTabColdParkCandidates(args: {
  terminalTabs: readonly TerminalTab[]
  assignments: ReadonlyMap<string, { isActiveInGroup: boolean }>
  isWorktreeActive: boolean
  portalTabIds: ReadonlySet<string>
  shouldMeasureHiddenWorktree: boolean
  /** Mutated in place: the hook owns this clock across passes. */
  hiddenSinceByTabId: Map<string, number>
  activationOrder: TerminalTabActivationOrder
  nowMs: number
}): TerminalTabColdParkCandidate[] {
  const visibleTabIds = new Set<string>()
  for (const terminalTab of args.terminalTabs) {
    if (args.isWorktreeActive && args.assignments.get(terminalTab.id)?.isActiveInGroup === true) {
      visibleTabIds.add(terminalTab.id)
    }
  }
  args.activationOrder.recordVisibleTabIds(visibleTabIds)

  return args.terminalTabs.map((terminalTab) => {
    const isVisible = visibleTabIds.has(terminalTab.id)
    const hasActivityTerminalPortal = args.portalTabIds.has(terminalTab.id)
    // Why measuring preserves the clock: the startup probe still needs mounted
    // panes (the hook's selection + render vetoes), but deleting hiddenSince
    // would restart the hysteresis AND desync per-tab deadlines from the
    // worktree retention/TTL clock on every ~3s probe.
    if (isVisible || hasActivityTerminalPortal) {
      args.hiddenSinceByTabId.delete(terminalTab.id)
    } else if (!args.shouldMeasureHiddenWorktree && !args.hiddenSinceByTabId.has(terminalTab.id)) {
      args.hiddenSinceByTabId.set(terminalTab.id, args.nowMs)
    }
    return {
      id: terminalTab.id,
      ptyId: terminalTab.ptyId,
      pendingActivationSpawn: terminalTab.pendingActivationSpawn,
      isVisible,
      hasActivityTerminalPortal,
      hiddenSinceMs: args.hiddenSinceByTabId.get(terminalTab.id) ?? null,
      lastActivatedSeq: args.activationOrder.getActivationSeq(terminalTab.id)
    }
  })
}
