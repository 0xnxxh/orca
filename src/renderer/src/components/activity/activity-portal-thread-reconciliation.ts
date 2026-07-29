export type ActivityPortalThreadRef = {
  paneKey: string
  worktree: { id: string }
  tab: { id: string }
}

export type ActivityPortalReconciliation<TThread extends ActivityPortalThreadRef> = {
  displayedIsSelectedTerminal: boolean
  visibleThread: TThread | null
  stagedThread: TThread | null
}

/**
 * Picks which thread the Activity portal shows now (visible) and which one is
 * warmed up in the inactive slot (staged).
 */
export function reconcileActivityPortalThreads<TThread extends ActivityPortalThreadRef>(args: {
  selectedThread: TThread | null
  displayedThread: TThread | null
  selectedHasLiveTab: boolean
  displayedHasLiveTab: boolean
}): ActivityPortalReconciliation<TThread> {
  const { selectedThread, displayedThread, selectedHasLiveTab, displayedHasLiveTab } = args
  // Why worktree+tab, not paneKey: Terminal mounts one TerminalPane per
  // (worktree, tab) and routes it by worktree+tab, so a same-tab staged
  // descriptor never gets a pane and its readiness never leaves 'loading' —
  // no swap arm fires and the old pane sticks. Same tab swaps in place via
  // isolatedPaneKey instead of staging.
  const displayedIsSelectedTerminal = Boolean(
    selectedThread &&
    displayedThread &&
    displayedThread.worktree.id === selectedThread.worktree.id &&
    displayedThread.tab.id === selectedThread.tab.id
  )
  const visibleThread =
    selectedThread && selectedHasLiveTab
      ? displayedThread && displayedHasLiveTab && displayedThread.paneKey !== selectedThread.paneKey
        ? displayedIsSelectedTerminal
          ? selectedThread
          : displayedThread
        : selectedThread
      : null
  const stagedThread =
    selectedThread &&
    selectedHasLiveTab &&
    visibleThread &&
    visibleThread.paneKey !== selectedThread.paneKey &&
    !displayedIsSelectedTerminal
      ? selectedThread
      : null
  return { displayedIsSelectedTerminal, visibleThread, stagedThread }
}

export type ActivityPortalSwap =
  | { kind: 'clear' }
  | { kind: 'swap-staged'; paneKey: string }
  | { kind: 'settle-visible'; paneKey: string }
  | null

/**
 * Decides how displayedPaneKey advances for one commit.
 *
 * Why 'unavailable' counts as settled: a stale or unresolvable pane must still
 * hand the slot over, otherwise the previous terminal stays on screen under the
 * newly selected row and the readiness pass retries forever.
 */
export function resolveActivityPortalSwap<TThread extends ActivityPortalThreadRef>(args: {
  selectedThread: TThread | null
  selectedHasLiveTab: boolean
  visibleThread: TThread | null
  stagedThread: TThread | null
  visiblePortalReady: boolean
  stagedPortalReady: boolean
  stagedPortalUnavailable: boolean
}): ActivityPortalSwap {
  const {
    selectedThread,
    selectedHasLiveTab,
    visibleThread,
    stagedThread,
    visiblePortalReady,
    stagedPortalReady,
    stagedPortalUnavailable
  } = args
  if (!selectedThread || !selectedHasLiveTab) {
    return { kind: 'clear' }
  }
  if (stagedThread && (stagedPortalReady || stagedPortalUnavailable)) {
    return { kind: 'swap-staged', paneKey: stagedThread.paneKey }
  }
  if (!stagedThread && visibleThread?.paneKey === selectedThread.paneKey && visiblePortalReady) {
    return { kind: 'settle-visible', paneKey: selectedThread.paneKey }
  }
  return null
}
