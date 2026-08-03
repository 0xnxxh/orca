import type { DashboardCard } from '../../../../shared/dashboard-snapshot'

export type AgentKanbanLineageNode = {
  card: DashboardCard
  children: AgentKanbanLineageNode[]
}

function hasParentCycle(card: DashboardCard, cardsByPaneKey: Map<string, DashboardCard>): boolean {
  const visited = new Set([card.paneKey])
  let parentPaneKey = card.parentPaneKey
  while (parentPaneKey) {
    if (visited.has(parentPaneKey)) {
      return true
    }
    visited.add(parentPaneKey)
    parentPaneKey = cardsByPaneKey.get(parentPaneKey)?.parentPaneKey
  }
  return false
}

export function buildAgentKanbanLineage(cards: DashboardCard[]): AgentKanbanLineageNode[] {
  const cardsByPaneKey = new Map(cards.map((card) => [card.paneKey, card]))
  const nodesByPaneKey = new Map<string, AgentKanbanLineageNode>(
    cards.map((card) => [card.paneKey, { card, children: [] }])
  )
  const roots: AgentKanbanLineageNode[] = []

  for (const card of cards) {
    const node = nodesByPaneKey.get(card.paneKey)
    const parent = card.parentPaneKey ? nodesByPaneKey.get(card.parentPaneKey) : undefined
    if (!node) {
      continue
    }
    if (!parent || hasParentCycle(card, cardsByPaneKey)) {
      roots.push(node)
      continue
    }
    parent.children.push(node)
  }

  return roots
}
