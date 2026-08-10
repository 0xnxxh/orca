import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore, type AppState } from '@/store'
import { resolveWorktreeStatus, type WorktreeStatus } from '@/lib/worktree-status'
import { EMPTY_BROWSER_TABS, EMPTY_TABS } from './WorktreeCardHelpers'
import {
  selectLivePtyIdsForWorktree,
  selectTerminalLayoutRootsForWorktree,
  selectRuntimePaneTitlesForWorktree
} from './worktree-card-status-inputs'
import { selectWorktreeAgentActivitySummary } from './worktree-agent-activity-summary'

export function useWorktreeActivityStatus(worktreeId: string): WorktreeStatus {
  const selectRuntimePaneTitles = useShallow((state: AppState) =>
    selectRuntimePaneTitlesForWorktree(state, worktreeId)
  )
  const selectLivePtyIds = useShallow((state: AppState) =>
    selectLivePtyIdsForWorktree(state, worktreeId)
  )
  const selectTerminalLayoutRoots = useShallow((state: AppState) =>
    selectTerminalLayoutRootsForWorktree(state, worktreeId)
  )
  const selectAgentActivitySummary = useShallow((state: AppState) =>
    selectWorktreeAgentActivitySummary(state, worktreeId)
  )
  const {
    tabs,
    browserTabs,
    runtimePaneTitlesForWorktree,
    ptyIdsForWorktree,
    terminalLayoutRootsByTabId,
    agentActivitySummary
  } = useAppStore(
    useShallow((state) => ({
      tabs: state.tabsByWorktree[worktreeId] ?? EMPTY_TABS,
      browserTabs: state.browserTabsByWorktree[worktreeId] ?? EMPTY_BROWSER_TABS,
      runtimePaneTitlesForWorktree: selectRuntimePaneTitles(state),
      ptyIdsForWorktree: selectLivePtyIds(state),
      terminalLayoutRootsByTabId: selectTerminalLayoutRoots(state),
      agentActivitySummary: selectAgentActivitySummary(state)
    }))
  )
  const { hasPermission, hasLiveWorking, hasLiveDone, hasRetainedDone, agentStatusPaneIdsByTabId } =
    agentActivitySummary

  // Why: compact and detailed cards need the same status-dot semantics:
  // runtime liveness gates title-derived states, then explicit agent rows can
  // promote working/permission/done so the dot matches visible agent state.
  return useMemo(
    () =>
      resolveWorktreeStatus({
        tabs,
        browserTabs,
        ptyIdsByTabId: ptyIdsForWorktree,
        runtimePaneTitlesByTabId: runtimePaneTitlesForWorktree,
        agentStatusPaneIdsByTabId,
        terminalLayoutRootsByTabId,
        hasPermission,
        hasLiveWorking,
        hasLiveDone,
        hasRetainedDone
      }),
    [
      tabs,
      browserTabs,
      ptyIdsForWorktree,
      runtimePaneTitlesForWorktree,
      agentStatusPaneIdsByTabId,
      terminalLayoutRootsByTabId,
      hasPermission,
      hasLiveWorking,
      hasLiveDone,
      hasRetainedDone
    ]
  )
}
