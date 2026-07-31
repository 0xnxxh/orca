import type { DashboardCard, DashboardCardDotState } from '../../../../shared/dashboard-snapshot'
import { layoutFleetAgentLineage } from './fleet-agent-lineage-layout'
import { packFleetWorktrees } from './fleet-worktree-packing'

export { FLEET_WORKTREE_GAP } from './fleet-worktree-packing'

export const FLEET_AGENT_RADIUS = 20
export const FLEET_AGGREGATE_ZOOM = 1.15

const PROJECT_GAP = 32
const PROJECT_PADDING = 16
const WORLD_MARGIN = 32
const GOLDEN_ANGLE = 2.399963229728653

export type FleetStatusCounts = Record<DashboardCardDotState, number>

export type FleetAgentNode = {
  card: DashboardCard
  x: number
  y: number
  radius: number
  durationMinutes: number
  status: DashboardCardDotState
}

export type FleetWorktreeRing = {
  id: string
  name: string
  x: number
  y: number
  radius: number
  agents: FleetAgentNode[]
  statusCounts: FleetStatusCounts
  quiet: boolean
}

export type FleetProjectRing = {
  id: string
  name: string
  x: number
  y: number
  radius: number
  worktrees: FleetWorktreeRing[]
  agentCount: number
}

export type FleetRingsLayout = {
  projects: FleetProjectRing[]
  width: number
  height: number
  topologyKey: string
}

export type FleetRingsLayoutCache = {
  topologyKey: string
  geometry: FleetRingsLayout
  packingGeneration: number
}

type LocalWorktree = Omit<FleetWorktreeRing, 'x' | 'y'> & { x: number; y: number }
type LocalProject = Omit<FleetProjectRing, 'x' | 'y' | 'worktrees'> & {
  worktrees: LocalWorktree[]
}

function compareStable(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function hashFraction(value: string): number {
  return stableHash(value) / 0xffffffff
}

function topologyIdentity(card: DashboardCard): string {
  const parentPaneKey = card.parentPaneKey ?? ''
  return `${card.repoId.length}:${card.repoId}${card.worktreeId.length}:${card.worktreeId}${card.paneKey.length}:${card.paneKey}${parentPaneKey.length}:${parentPaneKey}`
}

export function fleetRingsTopologyKey(cards: DashboardCard[]): string {
  return cards.map(topologyIdentity).sort(compareStable).join('|')
}

export function fleetAgentDurationMinutes(card: DashboardCard, now: number): number {
  if (!Number.isFinite(card.startedAt) || card.startedAt <= 0) {
    return 0
  }
  const end = card.finishedAt && card.finishedAt >= card.startedAt ? card.finishedAt : now
  return Math.max(0, (end - card.startedAt) / 60_000)
}

export function fleetNodeStatus(card: DashboardCard): DashboardCardDotState {
  return card.dotState
}

export function shouldAggregateFleetWorktree(
  worktree: FleetWorktreeRing,
  zoom: number,
  allowAggregation = true
): boolean {
  return (
    allowAggregation && zoom < FLEET_AGGREGATE_ZOOM && worktree.quiet && worktree.agents.length > 3
  )
}

function emptyStatusCounts(): FleetStatusCounts {
  return { working: 0, blocked: 0, waiting: 0, done: 0, idle: 0 }
}

function worktreeRadius(agentCount: number): number {
  return Math.max(62, 34 + Math.ceil(Math.sqrt(Math.max(1, agentCount))) * (FLEET_AGENT_RADIUS + 8))
}

function placeAgents(
  worktreeId: string,
  cards: DashboardCard[],
  radius: number,
  now: number
): FleetAgentNode[] {
  const availableRadius = Math.max(0, radius - FLEET_AGENT_RADIUS - 10)
  const sorted = [...cards].sort((a, b) => compareStable(a.paneKey, b.paneKey))
  const capacity = Math.ceil(Math.sqrt(Math.max(1, sorted.length))) ** 2
  const angleOffset = hashFraction(worktreeId) * Math.PI * 2

  return sorted.map((card, index) => {
    const orbit = sorted.length === 1 ? 0 : Math.sqrt((index + 0.5) / capacity) * availableRadius
    const angle = angleOffset + index * GOLDEN_ANGLE
    return {
      card,
      x: Math.cos(angle) * orbit,
      y: Math.sin(angle) * orbit,
      radius: FLEET_AGENT_RADIUS,
      durationMinutes: fleetAgentDurationMinutes(card, now),
      status: fleetNodeStatus(card)
    }
  })
}

function buildLocalWorktree(id: string, cards: DashboardCard[], now: number): LocalWorktree {
  const lineageLayout = layoutFleetAgentLineage(cards, FLEET_AGENT_RADIUS)
  const radius = lineageLayout?.radius ?? worktreeRadius(cards.length)
  const statusCounts = emptyStatusCounts()
  for (const card of cards) {
    statusCounts[card.dotState] += 1
  }
  return {
    id,
    name: cards[0]?.worktreeName ?? id,
    x: 0,
    y: 0,
    radius,
    agents:
      lineageLayout?.agents.map(({ card, x, y }) => ({
        card,
        x,
        y,
        radius: FLEET_AGENT_RADIUS,
        durationMinutes: fleetAgentDurationMinutes(card, now),
        status: fleetNodeStatus(card)
      })) ?? placeAgents(id, cards, radius, now),
    statusCounts,
    quiet: statusCounts.working === 0 && statusCounts.blocked === 0 && statusCounts.waiting === 0
  }
}

function buildLocalProject(id: string, cards: DashboardCard[], now: number): LocalProject {
  const byWorktree = new Map<string, DashboardCard[]>()
  for (const card of cards) {
    const current = byWorktree.get(card.worktreeId)
    if (current) {
      current.push(card)
    } else {
      byWorktree.set(card.worktreeId, [card])
    }
  }
  const worktrees = packFleetWorktrees(
    [...byWorktree.entries()]
      .sort(([a], [b]) => compareStable(a, b))
      .map(([worktreeId, worktreeCards]) => buildLocalWorktree(worktreeId, worktreeCards, now))
  )
  const radius = Math.max(
    96,
    ...worktrees.map(
      (worktree) => Math.hypot(worktree.x, worktree.y) + worktree.radius + PROJECT_PADDING
    )
  )
  return {
    id,
    name: cards[0]?.repoName ?? id,
    radius,
    worktrees,
    agentCount: cards.length
  }
}

export function deriveFleetRingsLayout(cards: DashboardCard[], now: number): FleetRingsLayout {
  const topologyKey = fleetRingsTopologyKey(cards)
  if (cards.length === 0) {
    return { projects: [], width: 900, height: 560, topologyKey }
  }
  const byProject = new Map<string, DashboardCard[]>()
  for (const card of cards) {
    const current = byProject.get(card.repoId)
    if (current) {
      current.push(card)
    } else {
      byProject.set(card.repoId, [card])
    }
  }
  const localProjects = [...byProject.entries()]
    .sort(([a], [b]) => compareStable(a, b))
    .map(([projectId, projectCards]) => buildLocalProject(projectId, projectCards, now))
  const maxProjectRadius = Math.max(...localProjects.map((project) => project.radius))
  const centerY = WORLD_MARGIN + maxProjectRadius
  let cursorX = WORLD_MARGIN
  const projects = localProjects.map((project): FleetProjectRing => {
    const centerX = cursorX + project.radius
    cursorX += project.radius * 2 + PROJECT_GAP
    return {
      ...project,
      x: centerX,
      y: centerY,
      worktrees: project.worktrees.map((worktree) => ({
        ...worktree,
        x: centerX + worktree.x,
        y: centerY + worktree.y,
        agents: worktree.agents.map((agent) => ({
          ...agent,
          x: centerX + worktree.x + agent.x,
          y: centerY + worktree.y + agent.y
        }))
      }))
    }
  })
  return {
    projects,
    width: Math.max(900, cursorX - PROJECT_GAP + WORLD_MARGIN),
    height: Math.max(560, maxProjectRadius * 2 + WORLD_MARGIN * 2),
    topologyKey
  }
}

function refreshFleetRingsMetadata(
  geometry: FleetRingsLayout,
  cards: DashboardCard[],
  now: number
): FleetRingsLayout {
  const cardsByPaneKey = new Map(cards.map((card) => [card.paneKey, card]))
  const projects = geometry.projects.map((project) => {
    let projectName = project.name
    let agentCount = 0
    const worktrees = project.worktrees.map((worktree) => {
      let worktreeName = worktree.name
      const statusCounts = emptyStatusCounts()
      const agents = worktree.agents.flatMap((agent) => {
        const card = cardsByPaneKey.get(agent.card.paneKey)
        if (!card) {
          return []
        }
        projectName = card.repoName
        worktreeName = card.worktreeName
        agentCount += 1
        statusCounts[card.dotState] += 1
        return [
          {
            ...agent,
            card,
            durationMinutes: fleetAgentDurationMinutes(card, now),
            status: fleetNodeStatus(card)
          }
        ]
      })
      return {
        ...worktree,
        name: worktreeName,
        agents,
        statusCounts,
        quiet:
          statusCounts.working === 0 && statusCounts.blocked === 0 && statusCounts.waiting === 0
      }
    })
    return { ...project, name: projectName, worktrees, agentCount }
  })
  return { ...geometry, projects }
}

export function updateFleetRingsLayout(
  cache: FleetRingsLayoutCache | null,
  cards: DashboardCard[],
  now: number
): { cache: FleetRingsLayoutCache; layout: FleetRingsLayout } {
  const topologyKey = fleetRingsTopologyKey(cards)
  if (!cache || cache.topologyKey !== topologyKey) {
    const geometry = deriveFleetRingsLayout(cards, now)
    return {
      cache: {
        topologyKey,
        geometry,
        packingGeneration: (cache?.packingGeneration ?? 0) + 1
      },
      layout: geometry
    }
  }
  const layout = refreshFleetRingsMetadata(cache.geometry, cards, now)
  cache.geometry = layout
  return { cache, layout }
}
