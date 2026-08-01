import type { TerminalTab } from '../../../../shared/types'
import { recordRendererCrashBreadcrumb } from '../../lib/crash-breadcrumb-recorder'

const reportedDuplicateTabVerdicts = new Set<string>()

/** Test seam: the duplicate breadcrumb is once-per-tab-id-per-verdict per session. */
export function _resetDuplicateTabOwnerBreadcrumbsForTests(): void {
  reportedDuplicateTabVerdicts.clear()
}

/**
 * Resolve which worktree owns a terminal tab, preferring the active worktree.
 *
 * Why the preference: a stale map can leave one tab id under two worktrees, and
 * attributing it to an arbitrary first match leaves `activeTabId` permanently
 * unconvergeable — which strands Terminal's active-terminal repair effect in a
 * self-retriggering loop (React #185).
 */
export function resolveActiveTabOwnerWorktreeId(
  tabsByWorktree: Record<string, TerminalTab[]>,
  activeWorktreeId: string | null,
  tabId: string
): string | null {
  let firstOwnerId: string | null = null
  let ownerCount = 0
  // Why tracked in-loop rather than re-read by key: `tabsByWorktree[activeWorktreeId]`
  // resolves inherited members for ids like `toString`, and `?.some` would then throw.
  // Why the id and not a boolean: a falsy-but-valid active id ('') would fail a
  // truthiness guard below and silently fall back to the first match — the very
  // misattribution this function exists to remove.
  let activeOwnerId: string | null = null
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    if (!tabs.some((tab) => tab.id === tabId)) {
      continue
    }
    ownerCount += 1
    if (firstOwnerId === null) {
      firstOwnerId = worktreeId
    }
    if (worktreeId === activeWorktreeId) {
      activeOwnerId = worktreeId
    }
  }

  // Why breadcrumb: no production origin for a duplicated tab id is known yet,
  // so a crash bundle carrying this is what proves or kills the hypothesis.
  // Why the verdict is part of the guard key: only `false` says the activation
  // could not converge activeTabId, and the active worktree changes under a
  // persisting duplicate — keyed on the id alone, a tab whose first duplicate
  // resolved benignly would suppress the sample the crumb exists to capture.
  // Still at most two per tab id, and the main process coalesces each verdict
  // into its own single ring entry, so the flood bound is unchanged.
  const resolvedToActiveWorktree = activeOwnerId !== null
  const verdictKey = `${tabId}:${resolvedToActiveWorktree}`
  if (ownerCount > 1 && !reportedDuplicateTabVerdicts.has(verdictKey)) {
    reportedDuplicateTabVerdicts.add(verdictKey)
    recordRendererCrashBreadcrumb('terminal_tab_id_owned_by_multiple_worktrees', {
      ownerCount,
      resolvedToActiveWorktree
    })
  }

  if (ownerCount > 1 && activeOwnerId !== null) {
    return activeOwnerId
  }
  return firstOwnerId
}
