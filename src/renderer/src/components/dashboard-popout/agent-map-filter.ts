import {
  dashboardCardDisplayState,
  type DashboardCard,
  type DashboardCardHostKind
} from '../../../../shared/dashboard-snapshot'

export type AgentMapState = 'attention' | 'working' | 'done' | 'idle'
export type AgentMapHostFilter = 'all' | DashboardCardHostKind
export type AgentMapCounts = Record<AgentMapState, number>

export function agentMapState(card: DashboardCard): AgentMapState {
  const state = dashboardCardDisplayState(card)
  if (state === 'blocked' || state === 'waiting') {
    return 'attention'
  }
  return state
}

export function filterAgentMapCards({
  cards,
  enabledStates,
  hostFilter,
  hiddenProjectIds
}: {
  cards: DashboardCard[]
  enabledStates: ReadonlySet<AgentMapState>
  hostFilter: AgentMapHostFilter
  hiddenProjectIds: ReadonlySet<string>
}): DashboardCard[] {
  return cards.filter((card) => {
    if (
      (hostFilter !== 'all' && (card.hostKind ?? 'local') !== hostFilter) ||
      hiddenProjectIds.has(card.repoId)
    ) {
      return false
    }
    return enabledStates.has(agentMapState(card))
  })
}

export function countAgentMapCards(cards: DashboardCard[]): AgentMapCounts {
  const counts: AgentMapCounts = {
    attention: 0,
    working: 0,
    done: 0,
    idle: 0
  }
  for (const card of cards) {
    counts[agentMapState(card)] += 1
  }
  return counts
}
