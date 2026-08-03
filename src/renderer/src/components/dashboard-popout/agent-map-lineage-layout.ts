import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { packAgentMapWorktrees } from './agent-map-worktree-packing'

const LINEAGE_VERTICAL_GAP = 22
const FAMILY_PADDING = 4
const WORKTREE_PADDING = 10

export type AgentMapLineagePosition = {
  card: DashboardCard
  x: number
  y: number
}

type AgentMapAgentFamily = {
  id: string
  x: number
  y: number
  radius: number
  agents: AgentMapLineagePosition[]
}

function compareStable(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function encloseFamily(
  id: string,
  agents: AgentMapLineagePosition[],
  nodeRadius: number
): AgentMapAgentFamily {
  const left = Math.min(...agents.map((agent) => agent.x - nodeRadius))
  const right = Math.max(...agents.map((agent) => agent.x + nodeRadius))
  const top = Math.min(...agents.map((agent) => agent.y - nodeRadius))
  const bottom = Math.max(...agents.map((agent) => agent.y + nodeRadius))
  const centerX = (left + right) / 2
  const centerY = (top + bottom) / 2
  for (const agent of agents) {
    agent.x -= centerX
    agent.y -= centerY
  }
  return {
    id,
    x: 0,
    y: 0,
    radius:
      Math.max(...agents.map((agent) => Math.hypot(agent.x, agent.y))) +
      nodeRadius +
      FAMILY_PADDING,
    agents
  }
}

function buildFamily(
  root: DashboardCard,
  childrenByParent: ReadonlyMap<string, DashboardCard[]>,
  nodeRadius: number,
  emitted: Set<string>
): AgentMapAgentFamily {
  const buildSubtree = (
    card: DashboardCard,
    ancestors: ReadonlySet<string>
  ): AgentMapAgentFamily => {
    emitted.add(card.paneKey)
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(card.paneKey)
    const children = (childrenByParent.get(card.paneKey) ?? []).filter(
      (child) => !nextAncestors.has(child.paneKey) && !emitted.has(child.paneKey)
    )
    if (children.length === 0) {
      return {
        id: card.paneKey,
        x: 0,
        y: 0,
        radius: nodeRadius + FAMILY_PADDING,
        agents: [{ card, x: 0, y: 0 }]
      }
    }

    const childFamilies = packAgentMapWorktrees(
      children.map((child) => buildSubtree(child, nextAncestors))
    )
    const childLeft = Math.min(...childFamilies.map((family) => family.x - family.radius))
    const childRight = Math.max(...childFamilies.map((family) => family.x + family.radius))
    const childTop = Math.min(...childFamilies.map((family) => family.y - family.radius))
    const childOffsetX = -(childLeft + childRight) / 2
    const childOffsetY = nodeRadius + LINEAGE_VERTICAL_GAP - childTop - FAMILY_PADDING
    const agents = [{ card, x: 0, y: 0 }]
    for (const family of childFamilies) {
      for (const agent of family.agents) {
        agents.push({
          ...agent,
          x: agent.x + family.x + childOffsetX,
          y: agent.y + family.y + childOffsetY
        })
      }
    }
    return encloseFamily(card.paneKey, agents, nodeRadius)
  }

  return buildSubtree(root, new Set())
}

export function layoutAgentMapLineage(
  cards: DashboardCard[],
  nodeRadius: number
): { agents: AgentMapLineagePosition[]; radius: number } | null {
  const sorted = [...cards].sort((a, b) => compareStable(a.paneKey, b.paneKey))
  const cardsByPaneKey = new Map(sorted.map((card) => [card.paneKey, card]))
  const childrenByParent = new Map<string, DashboardCard[]>()
  const childPaneKeys = new Set<string>()

  for (const card of sorted) {
    const parentPaneKey = card.parentPaneKey
    if (!parentPaneKey || parentPaneKey === card.paneKey || !cardsByPaneKey.has(parentPaneKey)) {
      continue
    }
    childPaneKeys.add(card.paneKey)
    childrenByParent.set(parentPaneKey, [...(childrenByParent.get(parentPaneKey) ?? []), card])
  }
  if (childPaneKeys.size === 0) {
    return null
  }

  const emitted = new Set<string>()
  const roots = sorted.filter((card) => !childPaneKeys.has(card.paneKey))
  const families: AgentMapAgentFamily[] = []
  for (const root of roots) {
    if (!emitted.has(root.paneKey)) {
      families.push(buildFamily(root, childrenByParent, nodeRadius, emitted))
    }
  }
  for (const card of sorted) {
    if (!emitted.has(card.paneKey)) {
      families.push(buildFamily(card, childrenByParent, nodeRadius, emitted))
    }
  }
  const packed = packAgentMapWorktrees(families)
  return {
    agents: packed
      .flatMap((family) =>
        family.agents.map((agent) => ({
          ...agent,
          x: family.x + agent.x,
          y: family.y + agent.y
        }))
      )
      .sort((a, b) => compareStable(a.card.paneKey, b.card.paneKey)),
    radius: Math.max(
      62,
      ...packed.map((family) => Math.hypot(family.x, family.y) + family.radius + WORKTREE_PADDING)
    )
  }
}
