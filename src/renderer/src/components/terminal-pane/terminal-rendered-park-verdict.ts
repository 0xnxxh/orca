/**
 * The rendered park verdict for one worktree's terminal tabs.
 *
 * Why a pure module: render and the watcher-sync effect must consume the exact
 * same set. Activation-deferred tabs are already approved for watcher handoff
 * by Terminal's mount planner; a failed handoff reveals the tab monotonically
 * instead of changing this render verdict (React #185).
 */
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import {
  findActivityTerminalPortal,
  type ActivityTerminalPortalTarget
} from '../activity/activity-terminal-portal'

type TerminalOverlayTabAssignment = {
  groupId: string
  isActiveInGroup: boolean
}

export function selectRenderedParkedTerminalTabIds(args: {
  worktreeId: string
  terminalTabs: readonly TerminalTab[]
  assignments: ReadonlyMap<string, TerminalOverlayTabAssignment>
  isWorktreeActive: boolean
  activityTerminalPortals: ActivityTerminalPortalTarget[]
  coldParkTerminalPanes: boolean
  coldParkedTerminalTabIds: ReadonlySet<string>
  sleepingRecordOwnedTabIds: ReadonlySet<string>
  evictionExemptTerminalTabIds: ReadonlySet<string>
  shouldMeasureHiddenWorktree: boolean
  activationDeferredMountTabIds: ReadonlySet<string> | null | undefined
}): Set<string> {
  const parked = new Set<string>()
  for (const terminalTab of args.terminalTabs) {
    const assignment = args.assignments.get(terminalTab.id)
    const isVisible = Boolean(args.isWorktreeActive && assignment && assignment.isActiveInGroup)
    const hasActivityTerminalPortal =
      findActivityTerminalPortal(args.activityTerminalPortals, {
        worktreeId: args.worktreeId,
        tabId: terminalTab.id
      }) !== null
    if (
      (args.coldParkTerminalPanes ||
        (!isVisible &&
          args.coldParkedTerminalTabIds.has(terminalTab.id) &&
          // Why: a pane owning a sleeping-session record must stay mountable
          // on an active worktree — parked it can never cold-restore, so the
          // agent's resume strands until the user reveals the tab. Scoped to
          // per-tab parks: the worktree-level park clears on activation.
          !args.sleepingRecordOwnedTabIds.has(terminalTab.id))) &&
      !hasActivityTerminalPortal &&
      // Why: a force-parked worktree's eviction-exempt tabs keep their
      // mounted panes — a remount would orphan their live pty. Scoped to
      // force-parks: ordinary parks never contain exempt tabs (eligibility
      // requires every tab restorable, so the memo is empty for them).
      !args.evictionExemptTerminalTabIds.has(terminalTab.id) &&
      // Why: the hidden-measuring startup probe needs mounted panes; gate
      // here too so the reveal lands in the same render that starts it.
      !args.shouldMeasureHiddenWorktree
    ) {
      parked.add(terminalTab.id)
    }
    // Why: activation-deferred tabs render no pane regardless of the park
    // policy, so watchers must own their side effects immediately. Targeted
    // restrictions do not enter this set or add a new eager watcher burst.
    if (args.activationDeferredMountTabIds?.has(terminalTab.id) && !hasActivityTerminalPortal) {
      parked.add(terminalTab.id)
    }
  }
  return parked
}
