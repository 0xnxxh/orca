import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { ScrollState } from '@/lib/pane-manager/pane-manager-types'
import {
  hideTerminalVisibility,
  resumeTerminalVisibility,
  type TerminalHiddenReason
} from './terminal-visibility-resume'

export type TerminalVisibilityBookkeepingRefs = {
  wasVisibleRef: { current: boolean }
  wasWorktreeActiveRef: { current: boolean }
  hasCompletedVisibleResumeRef: { current: boolean }
  renderingSuspendedByVisibilityRef: { current: boolean }
  hiddenReasonRef: { current: TerminalHiddenReason | null }
}

type ApplyTerminalVisibilityTransitionArgs = TerminalVisibilityBookkeepingRefs & {
  manager: PaneManager | null
  rendererVisible: boolean
  isActive: boolean
  isWorktreeActive: boolean
  captureViewportPositions: (useRememberedSnapshots: boolean) => Map<number, ScrollState>
  withSuppressedScrollTracking: (callback: () => void) => void
  applyPendingFollowOutputRequests: () => void
}

// Why: PaneManager is created in a passive lifecycle effect after the layout
// visibility pass. When manager is still null on a visible mount, still record
// completion so the first intra-worktree hide does not take the
// !hasCompletedVisibleResume suspend branch (that wrongly disposes WebGL).
// openTerminal already attaches WebGL for visible mounts.
export function applyTerminalVisibilityTransition(
  args: ApplyTerminalVisibilityTransitionArgs
): void {
  const {
    manager,
    rendererVisible,
    isActive,
    isWorktreeActive,
    wasVisibleRef,
    wasWorktreeActiveRef,
    hasCompletedVisibleResumeRef,
    renderingSuspendedByVisibilityRef,
    hiddenReasonRef,
    captureViewportPositions,
    withSuppressedScrollTracking,
    applyPendingFollowOutputRequests
  } = args

  if (!manager) {
    if (rendererVisible) {
      wasVisibleRef.current = true
      wasWorktreeActiveRef.current = isWorktreeActive
      hasCompletedVisibleResumeRef.current = true
      renderingSuspendedByVisibilityRef.current = false
      hiddenReasonRef.current = null
    } else {
      wasVisibleRef.current = false
      wasWorktreeActiveRef.current = isWorktreeActive
    }
    return
  }

  const wasVisible = wasVisibleRef.current
  const wasWorktreeActive = wasWorktreeActiveRef.current
  if (rendererVisible) {
    const shouldUseLightTabResume =
      isWorktreeActive &&
      hasCompletedVisibleResumeRef.current &&
      !renderingSuspendedByVisibilityRef.current &&
      (wasVisible || hiddenReasonRef.current === 'tab')
    resumeTerminalVisibility({
      manager,
      isActive,
      wasVisible,
      shouldUseLightTabResume,
      captureViewportPositions,
      withSuppressedScrollTracking
    })
    renderingSuspendedByVisibilityRef.current = false
    wasVisibleRef.current = true
    wasWorktreeActiveRef.current = isWorktreeActive
    hasCompletedVisibleResumeRef.current = true
    hiddenReasonRef.current = null
    applyPendingFollowOutputRequests()
    return
  }

  const hiddenState = hideTerminalVisibility({
    manager,
    wasVisible,
    wasWorktreeActive,
    isWorktreeActive,
    hasCompletedVisibleResume: hasCompletedVisibleResumeRef.current,
    captureViewportPositions
  })
  renderingSuspendedByVisibilityRef.current = hiddenState.renderingSuspended
  hiddenReasonRef.current = hiddenState.hiddenReason
  wasVisibleRef.current = false
  wasWorktreeActiveRef.current = isWorktreeActive
}
