import type { DashboardCard } from '../../../../shared/dashboard-snapshot'

export function agentMapCardTopologyIdentity(card: DashboardCard): string {
  const parentPaneKey = card.parentPaneKey ?? ''
  const parentWorktreeId = card.parentWorktreeId ?? ''
  const executionHostId = card.executionHostId ?? ''
  return `${card.repoId.length}:${card.repoId}${card.worktreeId.length}:${card.worktreeId}${executionHostId.length}:${executionHostId}${card.paneKey.length}:${card.paneKey}${parentPaneKey.length}:${parentPaneKey}${parentWorktreeId.length}:${parentWorktreeId}`
}

export function agentMapWorktreeIdentityFromParts(
  worktreeId: string,
  executionHostId: DashboardCard['executionHostId']
): string {
  const hostId = executionHostId ?? ''
  return `${worktreeId.length}:${worktreeId}${hostId.length}:${hostId}`
}

export function agentMapWorktreeIdentity(card: DashboardCard): string {
  return agentMapWorktreeIdentityFromParts(card.worktreeId, card.executionHostId)
}
