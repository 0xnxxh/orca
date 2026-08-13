import {
  dashboardCardDisplayState,
  type DashboardCard,
  type DashboardCardDotState
} from '../../../../shared/dashboard-snapshot'

/** Map-only refinement of the shared dot state. `dashboardCardDisplayState` folds an
 *  acknowledged finish into `idle`, which is right for bucket counts but loses the one
 *  distinction the map exists to show: finished-and-unread vs finished-and-still-yours.
 *  Kept local so `DashboardCardDotState` — which crosses the pop-out bridge — is unchanged. */
export type AgentMapNodeStatus = DashboardCardDotState | 'done-seen'

export function agentMapDurationMinutes(card: DashboardCard, now: number): number {
  if (!Number.isFinite(card.startedAt) || card.startedAt <= 0) {
    return 0
  }
  const end = card.finishedAt && card.finishedAt >= card.startedAt ? card.finishedAt : now
  return Math.max(0, (end - card.startedAt) / 60_000)
}

export function agentMapNodeStatus(card: DashboardCard): AgentMapNodeStatus {
  if (card.dotState === 'done') {
    return card.unseen ? 'done' : 'done-seen'
  }
  return dashboardCardDisplayState(card)
}

/** How long a fresh finish keeps its one-shot flare. Long enough to catch the eye from
 *  across the map, short enough that a busy fleet is never permanently animating.
 *  Must stay in step with the `agent-map-finish-flare` duration in `agent-map.css`, or
 *  the element unmounts mid-ripple; the glow performance test asserts the two match. */
export const AGENT_MAP_FINISH_FLARE_MS = 1_400

/** Gates the flare element so only the handful of nodes that just changed carry animated
 *  paint work — the rest of the fleet stays static, per the glow performance boundary.
 *
 *  Deliberately reads the wall clock instead of the map's `now` prop: `now` ticks once
 *  every 30s to refresh relative timestamps, so measuring a 1s window against it fires at
 *  random moments rather than on the transition. The map re-renders when the card's state
 *  changes, so the wall clock is ~0ms past `stateChangedAt` exactly when it matters. */
export function isAgentMapRecentFinish(card: DashboardCard): boolean {
  if (agentMapNodeStatus(card) !== 'done') {
    return false
  }
  const changedAt = card.stateChangedAt || card.finishedAt || 0
  if (changedAt <= 0) {
    return false
  }
  const elapsed = Date.now() - changedAt
  // A fleet that loads with finished work already on it must not flare all at once, so a
  // finish that happened before this render window is never treated as fresh.
  return elapsed >= 0 && elapsed < AGENT_MAP_FINISH_FLARE_MS
}

export type AgentMapStatusCounts = Record<AgentMapNodeStatus, number>

export function emptyAgentMapStatusCounts(): AgentMapStatusCounts {
  return { working: 0, blocked: 0, waiting: 0, done: 0, 'done-seen': 0, idle: 0 }
}

/** Finished work you have already opened is still yours to land, but it is not asking for
 *  attention. Counting it as quiet keeps ring aggregation and label declutter behaving
 *  exactly as they did when an acknowledged finish rendered as plain idle. */
export function agentMapQuietCount(counts: AgentMapStatusCounts): number {
  return counts.idle + counts['done-seen']
}
