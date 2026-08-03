import type { DashboardCard, DashboardCardHostKind } from '../../../../shared/dashboard-snapshot'

export type AgentMapFocusState = 'attention' | 'working' | 'finished'
export type AgentMapFinishedScope = 'review' | 'day' | 'week' | 'all'
export type AgentMapHostFilter = 'all' | DashboardCardHostKind

export type AgentMapFocusCounts = Record<AgentMapFocusState, number> &
  Record<AgentMapFinishedScope, number>

const DAY_MS = 24 * 60 * 60 * 1000

export function agentMapFocusState(card: DashboardCard): AgentMapFocusState | null {
  if (card.dotState === 'blocked' || card.dotState === 'waiting') {
    return 'attention'
  }
  if (card.dotState === 'working') {
    return 'working'
  }
  if (card.dotState === 'done') {
    return 'finished'
  }
  return null
}

function finishedTimestamp(card: DashboardCard): number {
  return card.finishedAt ?? card.stateChangedAt
}

export function finishedCardMatchesScope(
  card: DashboardCard,
  scope: AgentMapFinishedScope,
  now: number,
  reviewedPaneKeys: ReadonlySet<string>
): boolean {
  if (scope === 'review') {
    return !reviewedPaneKeys.has(card.paneKey)
  }
  if (scope === 'all') {
    return true
  }
  const timestamp = finishedTimestamp(card)
  if (timestamp <= 0) {
    return false
  }
  return timestamp >= now - (scope === 'day' ? DAY_MS : DAY_MS * 7)
}

export function filterAgentMapCards({
  cards,
  enabledStates,
  finishedScope,
  hostFilter,
  hiddenProjectIds,
  pinnedPaneKeys,
  reviewedPaneKeys,
  now
}: {
  cards: DashboardCard[]
  enabledStates: ReadonlySet<AgentMapFocusState>
  finishedScope: AgentMapFinishedScope
  hostFilter: AgentMapHostFilter
  hiddenProjectIds: ReadonlySet<string>
  pinnedPaneKeys: ReadonlySet<string>
  reviewedPaneKeys: ReadonlySet<string>
  now: number
}): DashboardCard[] {
  return cards.filter((card) => {
    if (pinnedPaneKeys.has(card.paneKey)) {
      return true
    }
    if (
      (hostFilter !== 'all' && (card.hostKind ?? 'local') !== hostFilter) ||
      hiddenProjectIds.has(card.repoId)
    ) {
      return false
    }
    const state = agentMapFocusState(card)
    if (!state || !enabledStates.has(state)) {
      return false
    }
    return (
      state !== 'finished' || finishedCardMatchesScope(card, finishedScope, now, reviewedPaneKeys)
    )
  })
}

export function countAgentMapCards(
  cards: DashboardCard[],
  now: number,
  reviewedPaneKeys: ReadonlySet<string>
): AgentMapFocusCounts {
  const counts: AgentMapFocusCounts = {
    attention: 0,
    working: 0,
    finished: 0,
    review: 0,
    day: 0,
    week: 0,
    all: 0
  }
  for (const card of cards) {
    const state = agentMapFocusState(card)
    if (state) {
      counts[state] += 1
    }
    if (state !== 'finished') {
      continue
    }
    counts.all += 1
    for (const scope of ['review', 'day', 'week'] as const) {
      if (finishedCardMatchesScope(card, scope, now, reviewedPaneKeys)) {
        counts[scope] += 1
      }
    }
  }
  return counts
}
