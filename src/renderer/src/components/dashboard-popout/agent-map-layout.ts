import type { DashboardCard, DashboardCardDotState } from '../../../../shared/dashboard-snapshot'
import { layoutAgentMapLineage } from './agent-map-lineage-layout'
import { packAgentMapWorktrees } from './agent-map-worktree-packing'

export { AGENT_MAP_WORKTREE_GAP } from './agent-map-worktree-packing'

export const AGENT_MAP_AGENT_RADIUS = 20
export const AGENT_MAP_AGGREGATE_ZOOM = 1.15

const PROJECT_GAP = 32
const PROJECT_PADDING = 16
const WORLD_MARGIN = 32
const GOLDEN_ANGLE = 2.399963229728653

export type AgentMapStatusCounts = Record<DashboardCardDotState, number>

export type AgentMapAgentNode = {
  card: DashboardCard
  x: number
  y: number
  radius: number
  durationMinutes: number
  status: DashboardCardDotState
}

export type AgentMapWorktreeRing = {
  id: string
  name: string
  workspaceKind: NonNullable<DashboardCard['workspaceKind']>
  x: number
  y: number
  radius: number
  agents: AgentMapAgentNode[]
  statusCounts: AgentMapStatusCounts
  quiet: boolean
}

export type AgentMapProjectRing = {
  id: string
  name: string
  x: number
  y: number
  radius: number
  worktrees: AgentMapWorktreeRing[]
  agentCount: number
}

export type AgentMapLayout = {
  projects: AgentMapProjectRing[]
  width: number
  height: number
  topologyKey: string
}

export type AgentMapLayoutCache = {
  topologyKey: string
  geometry: AgentMapLayout
  packingGeneration: number
}

type LocalWorktree = Omit<AgentMapWorktreeRing, 'x' | 'y'> & { x: number; y: number }
type LocalProject = Omit<AgentMapProjectRing, 'x' | 'y' | 'worktrees'> & {
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

export function agentMapTopologyKey(cards: DashboardCard[]): string {
  return cards.map(topologyIdentity).sort(compareStable).join('|')
}

export function agentMapDurationMinutes(card: DashboardCard, now: number): number {
  if (!Number.isFinite(card.startedAt) || card.startedAt <= 0) {
    return 0
  }
  const end = card.finishedAt && card.finishedAt >= card.startedAt ? card.finishedAt : now
  return Math.max(0, (end - card.startedAt) / 60_000)
}

export function agentMapNodeStatus(card: DashboardCard): DashboardCardDotState {
  return card.dotState
}

export function shouldAggregateAgentMapWorktree(
  worktree: AgentMapWorktreeRing,
  zoom: number,
  allowAggregation = true
): boolean {
  return (
    allowAggregation &&
    zoom < AGENT_MAP_AGGREGATE_ZOOM &&
    worktree.quiet &&
    worktree.agents.length > 3
  )
}

function emptyStatusCounts(): AgentMapStatusCounts {
  return { working: 0, blocked: 0, waiting: 0, done: 0, idle: 0 }
}

function worktreeRadius(agentCount: number): number {
  return Math.max(
    62,
    34 + Math.ceil(Math.sqrt(Math.max(1, agentCount))) * (AGENT_MAP_AGENT_RADIUS + 8)
  )
}

function placeAgents(
  worktreeId: string,
  cards: DashboardCard[],
  radius: number,
  now: number
): AgentMapAgentNode[] {
  const availableRadius = Math.max(0, radius - AGENT_MAP_AGENT_RADIUS - 10)
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
      radius: AGENT_MAP_AGENT_RADIUS,
      durationMinutes: agentMapDurationMinutes(card, now),
      status: agentMapNodeStatus(card)
    }
  })
}

function buildLocalWorktree(id: string, cards: DashboardCard[], now: number): LocalWorktree {
  const lineageLayout = layoutAgentMapLineage(cards, AGENT_MAP_AGENT_RADIUS)
  const radius = lineageLayout?.radius ?? worktreeRadius(cards.length)
  const statusCounts = emptyStatusCounts()
  for (const card of cards) {
    statusCounts[card.dotState] += 1
  }
  return {
    id,
    name: cards[0]?.worktreeName ?? id,
    workspaceKind: cards[0]?.workspaceKind ?? 'worktree',
    x: 0,
    y: 0,
    radius,
    agents:
      lineageLayout?.agents.map(({ card, x, y }) => ({
        card,
        x,
        y,
        radius: AGENT_MAP_AGENT_RADIUS,
        durationMinutes: agentMapDurationMinutes(card, now),
        status: agentMapNodeStatus(card)
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
  const worktrees = packAgentMapWorktrees(
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

export function deriveAgentMapLayout(cards: DashboardCard[], now: number): AgentMapLayout {
  const topologyKey = agentMapTopologyKey(cards)
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
  const projectSpanWidth = localProjects.reduce((sum, project) => sum + project.radius * 2, 0)
  const naturalWidth =
    projectSpanWidth + PROJECT_GAP * (localProjects.length - 1) + WORLD_MARGIN * 2
  const naturalHeight = maxProjectRadius * 2 + WORLD_MARGIN * 2
  const width = Math.max(900, naturalWidth)
  const height = Math.max(560, naturalHeight)
  const centerY = WORLD_MARGIN + maxProjectRadius + (height - naturalHeight) / 2
  let cursorX = WORLD_MARGIN + (width - naturalWidth) / 2
  const projects = localProjects.map((project): AgentMapProjectRing => {
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
  return { projects, width, height, topologyKey }
}

function refreshAgentMapMetadata(
  geometry: AgentMapLayout,
  cards: DashboardCard[],
  now: number
): AgentMapLayout {
  const cardsByPaneKey = new Map(cards.map((card) => [card.paneKey, card]))
  const projects = geometry.projects.map((project) => {
    let projectName = project.name
    let agentCount = 0
    const worktrees = project.worktrees.map((worktree) => {
      let worktreeName = worktree.name
      let workspaceKind = worktree.workspaceKind
      const statusCounts = emptyStatusCounts()
      const agents = worktree.agents.flatMap((agent) => {
        const card = cardsByPaneKey.get(agent.card.paneKey)
        if (!card) {
          return []
        }
        projectName = card.repoName
        worktreeName = card.worktreeName
        workspaceKind = card.workspaceKind ?? 'worktree'
        agentCount += 1
        statusCounts[card.dotState] += 1
        return [
          {
            ...agent,
            card,
            durationMinutes: agentMapDurationMinutes(card, now),
            status: agentMapNodeStatus(card)
          }
        ]
      })
      return {
        ...worktree,
        name: worktreeName,
        workspaceKind,
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

export function updateAgentMapLayout(
  cache: AgentMapLayoutCache | null,
  cards: DashboardCard[],
  now: number
): { cache: AgentMapLayoutCache; layout: AgentMapLayout } {
  const topologyKey = agentMapTopologyKey(cards)
  if (!cache || cache.topologyKey !== topologyKey) {
    const geometry = deriveAgentMapLayout(cards, now)
    return {
      cache: {
        topologyKey,
        geometry,
        packingGeneration: (cache?.packingGeneration ?? 0) + 1
      },
      layout: geometry
    }
  }
  const layout = refreshAgentMapMetadata(cache.geometry, cards, now)
  return { cache, layout }
}
