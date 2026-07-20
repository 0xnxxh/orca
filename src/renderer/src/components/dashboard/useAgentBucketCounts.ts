import { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { DashboardBucket } from '../../../../shared/dashboard-snapshot'
import { buildDashboardSnapshot } from './build-dashboard-snapshot'

export type AgentBucketCounts = Record<DashboardBucket, number>

const EMPTY_COUNTS: AgentBucketCounts = { attention: 0, working: 0, idle: 0 }

/**
 * Per-state agent counts for the sidebar dashboard entry, derived from the same
 * builder that feeds the pop-out board so the numbers always agree. Recomputes
 * only when an input slice changes (mirrors useDashboardData's cost profile).
 */
export function useAgentBucketCounts(): AgentBucketCounts {
  const repos = useAppStore((s) => s.repos)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const retainedAgentsByPaneKey = useAppStore((s) => s.retainedAgentsByPaneKey)
  const migrationUnsupportedByPtyId = useAppStore((s) => s.migrationUnsupportedByPtyId)
  const runtimeAgentOrchestrationByPaneKey = useAppStore(
    (s) => s.runtimeAgentOrchestrationByPaneKey
  )
  const terminalLayoutsByTabId = useAppStore((s) => s.terminalLayoutsByTabId)
  const ptyIdsByTabId = useAppStore((s) => s.ptyIdsByTabId)
  const runtimePaneTitlesByTabId = useAppStore((s) => s.runtimePaneTitlesByTabId)
  const agentStatusEpoch = useAppStore((s) => s.agentStatusEpoch)

  return useMemo(() => {
    const snapshot = buildDashboardSnapshot(
      {
        repos,
        worktreesByRepo,
        tabsByWorktree,
        agentStatusByPaneKey,
        retainedAgentsByPaneKey,
        migrationUnsupportedByPtyId,
        runtimeAgentOrchestrationByPaneKey,
        terminalLayoutsByTabId,
        ptyIdsByTabId,
        runtimePaneTitlesByTabId,
        // Counts do not render acknowledgement state, so avoid subscribing the sidebar to it.
        acknowledgedAgentsByPaneKey: {}
      },
      Date.now()
    )
    if (snapshot.cards.length === 0) {
      return EMPTY_COUNTS
    }
    const counts: AgentBucketCounts = { attention: 0, working: 0, idle: 0 }
    for (const card of snapshot.cards) {
      counts[card.bucket] += 1
    }
    return counts
    // Why: Date.now() is read inside the memo (not a dep) so idle-decay tracks
    // agentStatusEpoch ticks, matching useDashboardData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    repos,
    worktreesByRepo,
    tabsByWorktree,
    agentStatusByPaneKey,
    retainedAgentsByPaneKey,
    migrationUnsupportedByPtyId,
    runtimeAgentOrchestrationByPaneKey,
    terminalLayoutsByTabId,
    ptyIdsByTabId,
    runtimePaneTitlesByTabId,
    agentStatusEpoch
  ])
}
