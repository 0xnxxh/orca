import type { DashboardBucket, DashboardCard } from '../../../../shared/dashboard-snapshot'

export const ACTIVITY_LANE_OLDER_AFTER_MS = 2 * 60 * 60 * 1_000

export type ActivityLaneRecentMinutes = 30 | 120 | 1_440
export type ActivityLaneStatusFilter = 'all' | DashboardBucket

export type ActivityLane = {
  id: string
  repoName: string
  worktreeName: string
  cards: DashboardCard[]
  latestActivityAt: number
}

export type ActivityTimelineBounds = {
  startPercent: number
  endPercent: number
  lineStartPercent: number
  widthPercent: number
  responsePercent: number | null
  clippedStart: boolean
}

function finiteTimestamp(timestamp: number | null | undefined): number | null {
  return timestamp && Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null
}

export function activityCardTimestamp(card: DashboardCard): number {
  return (
    finiteTimestamp(card.lastResponseAt) ??
    finiteTimestamp(card.finishedAt) ??
    finiteTimestamp(card.stateChangedAt) ??
    finiteTimestamp(card.startedAt) ??
    0
  )
}

export function filterActivityLaneCards(
  cards: DashboardCard[],
  options: {
    now: number
    recentMinutes: ActivityLaneRecentMinutes
    status: ActivityLaneStatusFilter
    showOlder: boolean
  }
): DashboardCard[] {
  const recentCutoff = options.now - options.recentMinutes * 60_000
  const olderCutoff = options.now - ACTIVITY_LANE_OLDER_AFTER_MS
  const matches = cards.filter((card) => {
    if (options.status !== 'all' && card.bucket !== options.status) {
      return false
    }
    if (card.bucket !== 'done') {
      return true
    }
    const activityAt = activityCardTimestamp(card)
    return activityAt >= recentCutoff && (options.showOlder || activityAt >= olderCutoff)
  })
  const cardsByPaneKey = new Map(cards.map((card) => [card.paneKey, card]))
  const visiblePaneKeys = new Set(matches.map((card) => card.paneKey))
  for (const card of matches) {
    const ancestors = new Set([card.paneKey])
    let parentPaneKey = card.parentPaneKey
    while (parentPaneKey && !ancestors.has(parentPaneKey)) {
      ancestors.add(parentPaneKey)
      visiblePaneKeys.add(parentPaneKey)
      parentPaneKey = cardsByPaneKey.get(parentPaneKey)?.parentPaneKey
    }
  }
  return cards.filter((card) => visiblePaneKeys.has(card.paneKey))
}

function compareCards(left: DashboardCard, right: DashboardCard): number {
  return left.startedAt - right.startedAt || left.paneKey.localeCompare(right.paneKey)
}

function rootCard(
  card: DashboardCard,
  cardsByPaneKey: ReadonlyMap<string, DashboardCard>
): DashboardCard {
  const visited = new Set([card.paneKey])
  let root = card
  while (root.parentPaneKey) {
    const parent = cardsByPaneKey.get(root.parentPaneKey)
    if (!parent || visited.has(parent.paneKey)) {
      break
    }
    visited.add(parent.paneKey)
    root = parent
  }
  return root
}

function orderLaneCards(cards: DashboardCard[]): DashboardCard[] {
  const lanePaneKeys = new Set(cards.map((card) => card.paneKey))
  const childrenByParent = new Map<string, DashboardCard[]>()
  for (const card of cards) {
    if (!card.parentPaneKey || !lanePaneKeys.has(card.parentPaneKey)) {
      continue
    }
    const children = childrenByParent.get(card.parentPaneKey) ?? []
    children.push(card)
    childrenByParent.set(card.parentPaneKey, children)
  }
  for (const children of childrenByParent.values()) {
    children.sort(compareCards)
  }

  const ordered: DashboardCard[] = []
  const emitted = new Set<string>()
  const visit = (card: DashboardCard): void => {
    if (emitted.has(card.paneKey)) {
      return
    }
    emitted.add(card.paneKey)
    ordered.push(card)
    for (const child of childrenByParent.get(card.paneKey) ?? []) {
      visit(child)
    }
  }
  cards
    .filter((card) => !card.parentPaneKey || !lanePaneKeys.has(card.parentPaneKey))
    .sort(compareCards)
    .forEach(visit)
  cards.sort(compareCards).forEach(visit)
  return ordered
}

export function buildActivityLanes(cards: DashboardCard[]): ActivityLane[] {
  const cardsByPaneKey = new Map(cards.map((card) => [card.paneKey, card]))
  const grouped = new Map<string, { root: DashboardCard; cards: DashboardCard[] }>()
  for (const card of cards) {
    const root = rootCard(card, cardsByPaneKey)
    const id = `${root.repoId.length}:${root.repoId}${root.worktreeId.length}:${root.worktreeId}`
    const lane = grouped.get(id)
    if (lane) {
      lane.cards.push(card)
    } else {
      grouped.set(id, { root, cards: [card] })
    }
  }

  return [...grouped.entries()]
    .map(([id, lane]) => ({
      id,
      repoName: lane.root.repoName,
      worktreeName: lane.root.worktreeName,
      cards: orderLaneCards(lane.cards),
      latestActivityAt: Math.max(...lane.cards.map(activityCardTimestamp))
    }))
    .sort(
      (left, right) =>
        right.latestActivityAt - left.latestActivityAt ||
        left.worktreeName.localeCompare(right.worktreeName)
    )
}

function timelinePercent(timestamp: number, rangeStart: number, rangeEnd: number): number {
  const clamped = Math.min(rangeEnd, Math.max(rangeStart, timestamp))
  return ((clamped - rangeStart) / Math.max(1, rangeEnd - rangeStart)) * 100
}

export function activityTimelineBounds(
  card: DashboardCard,
  now: number,
  recentMinutes: ActivityLaneRecentMinutes
): ActivityTimelineBounds {
  const rangeStart = now - recentMinutes * 60_000
  const rawEnd =
    card.bucket === 'done' ? (finiteTimestamp(card.finishedAt) ?? activityCardTimestamp(card)) : now
  const end = Math.min(now, rawEnd)
  const start = Math.min(finiteTimestamp(card.startedAt) ?? end, end)
  const startPercent = timelinePercent(start, rangeStart, now)
  const endPercent = timelinePercent(end, rangeStart, now)
  const lineStartPercent =
    endPercent - startPercent < 0.7 ? Math.max(0, endPercent - 0.7) : startPercent
  const responseAt = finiteTimestamp(card.lastResponseAt)
  return {
    startPercent,
    endPercent,
    lineStartPercent,
    widthPercent: Math.max(0.7, endPercent - lineStartPercent),
    responsePercent: responseAt ? timelinePercent(responseAt, rangeStart, now) : null,
    clippedStart: start < rangeStart
  }
}

export function activityDurationMs(card: DashboardCard, now: number): number {
  const end = card.bucket === 'done' ? (finiteTimestamp(card.finishedAt) ?? now) : now
  const start = finiteTimestamp(card.startedAt) ?? end
  return Math.max(0, end - start)
}
