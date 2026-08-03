import type { DashboardCard } from '../../../../shared/dashboard-snapshot'

export function agentMapCardTopologyIdentity(card: DashboardCard): string {
  const parentPaneKey = card.parentPaneKey ?? ''
  const executionHostId = card.executionHostId ?? ''
  return `${card.repoId.length}:${card.repoId}${card.worktreeId.length}:${card.worktreeId}${executionHostId.length}:${executionHostId}${card.paneKey.length}:${card.paneKey}${parentPaneKey.length}:${parentPaneKey}`
}

export function agentMapWorktreeIdentity(card: DashboardCard): string {
  const executionHostId = card.executionHostId ?? ''
  return `${card.worktreeId.length}:${card.worktreeId}${executionHostId.length}:${executionHostId}`
}
