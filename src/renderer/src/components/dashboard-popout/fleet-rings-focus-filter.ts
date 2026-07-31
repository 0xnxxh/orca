import type { DashboardCard, DashboardCardHostKind } from '../../../../shared/dashboard-snapshot'

export type FleetFocusState = 'attention' | 'working' | 'finished'
export type FleetFinishedScope = 'review' | 'day' | 'week' | 'all'
export type FleetHostFilter = 'all' | DashboardCardHostKind

export type FleetFocusCounts = Record<FleetFocusState, number> & Record<FleetFinishedScope, number>

const DAY_MS = 24 * 60 * 60 * 1000

export function fleetFocusState(card: DashboardCard): FleetFocusState | null {
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
  scope: FleetFinishedScope,
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

export function filterFleetFocusCards({
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
  enabledStates: ReadonlySet<FleetFocusState>
  finishedScope: FleetFinishedScope
  hostFilter: FleetHostFilter
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
    const state = fleetFocusState(card)
    if (!state || !enabledStates.has(state)) {
      return false
    }
    return (
      state !== 'finished' || finishedCardMatchesScope(card, finishedScope, now, reviewedPaneKeys)
    )
  })
}

export function countFleetFocusCards(
  cards: DashboardCard[],
  now: number,
  reviewedPaneKeys: ReadonlySet<string>
): FleetFocusCounts {
  const counts: FleetFocusCounts = {
    attention: 0,
    working: 0,
    finished: 0,
    review: 0,
    day: 0,
    week: 0,
    all: 0
  }
  for (const card of cards) {
    const state = fleetFocusState(card)
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
