import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { applyAgentRowLineage } from '@/components/dashboard/agent-row-lineage'
import { migrationUnsupportedToAgentStatusEntry } from '@/lib/migration-unsupported-agent-entry'
import { useAppStore, type AppState } from '@/store'
import {
  selectLivePtyIdsForWorktree,
  selectRuntimePaneTitlesForWorktree
} from './worktree-card-status-inputs'
import { buildWorktreeAgentRows } from './worktree-agent-rows'
import {
  selectLiveAgentStatusEntriesForWorktree,
  selectMigrationUnsupportedEntriesForWorktree,
  selectRuntimeAgentOrchestrationForWorktree,
  selectRetainedAgentEntriesForWorktree,
  selectTerminalLayoutsForWorktree
} from './worktree-agent-row-selectors'
import {
  createWorktreeAgentFreshnessSelector,
  EMPTY_WORKTREE_AGENT_FRESHNESS_SIGNATURE
} from './worktree-agent-freshness-selector'

export { buildWorktreeAgentRows } from './worktree-agent-rows'
export {
  selectLiveAgentStatusEntriesForWorktree,
  selectMigrationUnsupportedEntriesForWorktree,
  selectRuntimeAgentOrchestrationForWorktree,
  selectRetainedAgentEntriesForWorktree
} from './worktree-agent-row-selectors'

/**
 * Narrow per-worktree agent row hook used by the WorktreeCard inline agents
 * list. Produces live hook-reported agents plus retained "done" snapshots,
 * stale-decayed to 'idle' when the hook stream has gone quiet.
 *
 * Uses indexed per-worktree selectors rather than reusing useDashboardData's
 * cross-worktree aggregate. The index is rebuilt once per relevant immutable
 * store slice and then shared by every visible card, avoiding O(cards × agents)
 * selector work on high-frequency agent status pings.
 */
export function useWorktreeAgentRows(worktreeId: string, active = true): DashboardAgentRow[] {
  const selectAgentFreshness = useMemo(
    () => createWorktreeAgentFreshnessSelector(worktreeId),
    [worktreeId]
  )
  const selectLiveEntries = useShallow((state: AppState) =>
    active ? selectLiveAgentStatusEntriesForWorktree(state, worktreeId) : []
  )
  const selectMigrationUnsupported = useShallow((state: AppState) =>
    active ? selectMigrationUnsupportedEntriesForWorktree(state, worktreeId) : []
  )
  const selectRetained = useShallow((state: AppState) =>
    active ? selectRetainedAgentEntriesForWorktree(state, worktreeId) : []
  )
  const selectRuntimePaneTitles = useShallow((state: AppState) =>
    active ? selectRuntimePaneTitlesForWorktree(state, worktreeId) : {}
  )
  const selectLivePtyIds = useShallow((state: AppState) =>
    active ? selectLivePtyIdsForWorktree(state, worktreeId) : {}
  )
  const selectTerminalLayouts = useShallow((state: AppState) =>
    active ? selectTerminalLayoutsForWorktree(state, worktreeId) : {}
  )
  const selectRuntimeAgentOrchestration = useShallow((state: AppState) =>
    active ? selectRuntimeAgentOrchestrationForWorktree(state, worktreeId) : {}
  )
  // Why: narrow the subscriptions to only THIS worktree's entries via
  // useShallow. Subscribing to the whole agentStatusByPaneKey map would make
  // every on-screen card re-render on any agent-status update anywhere —
  // O(worktrees²) render amplification. Pre-filtering here means the card
  // only re-renders when something relevant to THIS worktree changes.
  // Why: keep the store selector limited to stable raw records. Converting
  // migration entries creates fresh objects with Date.now(), which breaks
  // useSyncExternalStore's cached-snapshot contract and can blank Electron.
  const {
    tabs,
    liveEntries,
    migrationUnsupported,
    retained,
    runtimePaneTitlesByTabId,
    ptyIdsByTabId,
    terminalLayoutsByTabId,
    runtimeAgentOrchestrationByPaneKey,
    agentFreshnessSignature
  } = useAppStore(
    useShallow((state) => ({
      tabs: active ? state.tabsByWorktree[worktreeId] : undefined,
      liveEntries: selectLiveEntries(state),
      migrationUnsupported: selectMigrationUnsupported(state),
      retained: selectRetained(state),
      runtimePaneTitlesByTabId: selectRuntimePaneTitles(state),
      ptyIdsByTabId: selectLivePtyIds(state),
      terminalLayoutsByTabId: selectTerminalLayouts(state),
      runtimeAgentOrchestrationByPaneKey: selectRuntimeAgentOrchestration(state),
      agentFreshnessSignature: active
        ? selectAgentFreshness(state)
        : EMPTY_WORKTREE_AGENT_FRESHNESS_SIGNATURE
    }))
  )

  return useMemo<DashboardAgentRow[]>(() => {
    if (!active) {
      return []
    }
    // Why: Date.now() is read inside the memo so stale-decay recalculates when
    // this worktree's freshness signature changes, even without new PTY data.
    const now = Date.now()
    const entries =
      migrationUnsupported.length > 0
        ? [
            ...liveEntries,
            ...migrationUnsupported.flatMap((unsupported) => {
              const entry = migrationUnsupportedToAgentStatusEntry(unsupported)
              return entry ? [entry] : []
            })
          ]
        : liveEntries
    return applyAgentRowLineage(
      buildWorktreeAgentRows({
        tabs: tabs ?? [],
        entries,
        retained,
        runtimePaneTitlesByTabId,
        ptyIdsByTabId,
        terminalLayoutsByTabId,
        runtimeAgentOrchestrationByPaneKey,
        now
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    tabs,
    liveEntries,
    migrationUnsupported,
    retained,
    runtimePaneTitlesByTabId,
    ptyIdsByTabId,
    terminalLayoutsByTabId,
    runtimeAgentOrchestrationByPaneKey,
    agentFreshnessSignature
  ])
}
