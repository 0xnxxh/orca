// Pure grouping for the glass cell map: repo sections holding worktree cells,
// each cell ranked by the state that most needs the user.

import type {
  DashboardBucket,
  DashboardCard,
  DashboardCardDotState
} from '../../../../shared/dashboard-snapshot'

export type AgentCellWorktree = {
  id: string
  name: string
  cards: DashboardCard[]
  /** The state driving the cell's edge glow — the worst one present. */
  worstDotState: DashboardCardDotState
  /** Newest response across the cell's agents, for the ask line's age. */
  lastResponseAt: number
}

export type AgentCellSection = {
  id: string
  name: string
  worktrees: AgentCellWorktree[]
  agentCount: number
}

const BUCKET_PRIORITY: Record<DashboardBucket, number> = {
  attention: 0,
  working: 1,
  done: 2,
  idle: 3
}

/** Lower wins: blocked outranks waiting, which outranks anything still running. */
const DOT_STATE_PRIORITY: Record<DashboardCardDotState, number> = {
  blocked: 0,
  waiting: 1,
  working: 2,
  done: 3,
  idle: 4
}

function compareCards(a: DashboardCard, b: DashboardCard): number {
  return (
    BUCKET_PRIORITY[a.bucket] - BUCKET_PRIORITY[b.bucket] || b.stateChangedAt - a.stateChangedAt
  )
}

function responseTimestamp(card: DashboardCard): number {
  if (card.finishedAt && card.finishedAt > 0) {
    return card.finishedAt
  }
  return card.stateChangedAt > 0 ? card.stateChangedAt : card.startedAt
}

export function worstDotState(cards: DashboardCard[]): DashboardCardDotState {
  let worst: DashboardCardDotState = 'idle'
  for (const card of cards) {
    if (DOT_STATE_PRIORITY[card.dotState] < DOT_STATE_PRIORITY[worst]) {
      worst = card.dotState
    }
  }
  return worst
}

/** The line to show under a cell's orbs, or null when nothing needs the user. */
export function askLine(card: DashboardCard): string | null {
  if (card.bucket !== 'attention') {
    return null
  }
  return card.askSummary?.trim() || card.lastAgentMessage?.trim() || null
}

function buildWorktreeCells(cards: DashboardCard[]): AgentCellWorktree[] {
  const worktrees = new Map<string, DashboardCard[]>()
  for (const card of cards) {
    worktrees.set(card.worktreeId, [...(worktrees.get(card.worktreeId) ?? []), card])
  }
  return [...worktrees.entries()]
    .map(([id, worktreeCards]) => ({
      id,
      name: worktreeCards[0]?.worktreeName ?? id,
      cards: [...worktreeCards].sort(compareCards),
      worstDotState: worstDotState(worktreeCards),
      lastResponseAt: Math.max(...worktreeCards.map(responseTimestamp))
    }))
    .sort(
      (a, b) =>
        compareCards(a.cards[0], b.cards[0]) ||
        b.cards.length - a.cards.length ||
        a.name.localeCompare(b.name)
    )
}

/** Group cards into repo sections, busiest repo first. */
export function buildAgentCellSections(cards: DashboardCard[]): AgentCellSection[] {
  const repos = new Map<string, DashboardCard[]>()
  for (const card of cards) {
    repos.set(card.repoId, [...(repos.get(card.repoId) ?? []), card])
  }
  return [...repos.entries()]
    .map(([id, repoCards]) => ({
      id,
      name: repoCards[0]?.repoName ?? id,
      agentCount: repoCards.length,
      worktrees: buildWorktreeCells(repoCards)
    }))
    .sort((a, b) => b.agentCount - a.agentCount || a.name.localeCompare(b.name))
}
