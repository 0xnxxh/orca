import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { AgentMapLayout } from './agent-map-layout'
import {
  agentMapDurationMinutes,
  agentMapNodeStatus,
  agentMapQuietCount,
  emptyAgentMapStatusCounts,
  isAgentMapRecentFinish
} from './agent-map-node-metadata'

export function refreshAgentMapMetadata(
  geometry: AgentMapLayout,
  cards: DashboardCard[],
  now: number
): AgentMapLayout {
  const cardsByPaneKey = new Map(cards.map((card) => [card.paneKey, card]))
  const projects = geometry.projects.map((project) => {
    let projectName = project.name
    let agentCount = 0
    const worktrees = project.worktrees.map((worktree) => {
      let worktreeName = worktree.name
      let workspaceKind = worktree.workspaceKind
      const statusCounts = emptyAgentMapStatusCounts()
      const agents = worktree.agents.flatMap((agent) => {
        const card = cardsByPaneKey.get(agent.card.paneKey)
        if (!card) {
          return []
        }
        projectName = card.repoName
        worktreeName = card.worktreeName
        workspaceKind = card.workspaceKind ?? 'worktree'
        agentCount += 1
        statusCounts[agentMapNodeStatus(card)] += 1
        return [
          {
            ...agent,
            card,
            durationMinutes: agentMapDurationMinutes(card, now),
            status: agentMapNodeStatus(card),
            finishedRecently: isAgentMapRecentFinish(card)
          }
        ]
      })
      return {
        ...worktree,
        name: worktreeName,
        workspaceKind,
        agents,
        statusCounts,
        quiet: agentMapQuietCount(statusCounts) === agents.length
      }
    })
    return { ...project, name: projectName, worktrees, agentCount }
  })
  return { ...geometry, projects }
}
