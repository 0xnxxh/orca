import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { packFleetWorktrees } from './fleet-worktree-packing'

const HORIZONTAL_GAP = 58
const VERTICAL_GAP = 62
const FAMILY_PADDING = 12
const WORKTREE_PADDING = 10

export type FleetLineageAgentPosition = {
  card: DashboardCard
  x: number
  y: number
}

type FleetAgentFamily = {
  id: string
  x: number
  y: number
  radius: number
  agents: FleetLineageAgentPosition[]
}

function compareStable(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function buildFamily(
  root: DashboardCard,
  childrenByParent: ReadonlyMap<string, DashboardCard[]>,
  nodeRadius: number,
  emitted: Set<string>
): FleetAgentFamily {
  const agents: FleetLineageAgentPosition[] = []
  let leafIndex = 0

  const placeSubtree = (
    card: DashboardCard,
    depth: number,
    ancestors: ReadonlySet<string>
  ): number => {
    if (ancestors.has(card.paneKey) || emitted.has(card.paneKey)) {
      return leafIndex++ * HORIZONTAL_GAP
    }
    emitted.add(card.paneKey)
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(card.paneKey)
    const children = (childrenByParent.get(card.paneKey) ?? []).filter(
      (child) => !nextAncestors.has(child.paneKey) && !emitted.has(child.paneKey)
    )
    const childXs = children.map((child) => placeSubtree(child, depth + 1, nextAncestors))
    const x =
      childXs.length > 0
        ? (Math.min(...childXs) + Math.max(...childXs)) / 2
        : leafIndex++ * HORIZONTAL_GAP
    agents.push({ card, x, y: depth * VERTICAL_GAP })
    return x
  }

  placeSubtree(root, 0, new Set())
  const centerX =
    (Math.min(...agents.map((agent) => agent.x)) + Math.max(...agents.map((agent) => agent.x))) / 2
  const centerY =
    (Math.min(...agents.map((agent) => agent.y)) + Math.max(...agents.map((agent) => agent.y))) / 2
  for (const agent of agents) {
    agent.x -= centerX
    agent.y -= centerY
  }
  return {
    id: root.paneKey,
    x: 0,
    y: 0,
    radius:
      Math.max(...agents.map((agent) => Math.hypot(agent.x, agent.y))) +
      nodeRadius +
      FAMILY_PADDING,
    agents
  }
}

export function layoutFleetAgentLineage(
  cards: DashboardCard[],
  nodeRadius: number
): { agents: FleetLineageAgentPosition[]; radius: number } | null {
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
  const families: FleetAgentFamily[] = []
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
  const packed = packFleetWorktrees(families)
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
