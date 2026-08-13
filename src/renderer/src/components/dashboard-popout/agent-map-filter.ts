import type {
  DashboardCard,
  DashboardCardHostKind,
  DashboardWorkspace
} from '../../../../shared/dashboard-snapshot'
import { agentMapNodeStatus } from './agent-map-node-metadata'

export type AgentMapState = 'attention' | 'working' | 'done' | 'idle'
export type AgentMapCounts = Record<AgentMapState, number>
export type AgentMapHostCounts = Record<DashboardCardHostKind, number>

export const ALL_AGENT_MAP_HOSTS: readonly DashboardCardHostKind[] = [
  'local',
  'ssh',
  'wsl',
  'remote'
]

export function agentMapState(card: DashboardCard): AgentMapState {
  const state = agentMapNodeStatus(card)
  if (state === 'blocked' || state === 'waiting') {
    return 'attention'
  }
  // Why: an acknowledged finish still paints emerald, so it has to answer the Done
  // chip. Filtering it as idle would let "hide idle" blank out visibly green nodes.
  if (state === 'done-seen') {
    return 'done'
  }
  return state
}

export function filterAgentMapCards({
  cards,
  enabledStates,
  enabledHosts
}: {
  cards: DashboardCard[]
  enabledStates: ReadonlySet<AgentMapState>
  enabledHosts: ReadonlySet<DashboardCardHostKind>
}): DashboardCard[] {
  // Project filtering lives in the shared toolbar filter, which has already
  // narrowed these cards.
  return cards.filter(
    (card) => enabledHosts.has(card.hostKind ?? 'local') && enabledStates.has(agentMapState(card))
  )
}

export function countAgentMapHosts(
  cards: DashboardCard[],
  workspaces: readonly DashboardWorkspace[] = []
): AgentMapHostCounts {
  const counts: AgentMapHostCounts = { local: 0, ssh: 0, wsl: 0, remote: 0 }
  for (const card of cards) {
    counts[card.hostKind ?? 'local'] += 1
  }
  for (const workspace of workspaces) {
    counts[workspace.hostKind] += 1
  }
  return counts
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
