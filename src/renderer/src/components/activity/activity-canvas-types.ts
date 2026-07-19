import type { AgentStatusState, AgentType } from '../../../../shared/agent-status-types'

export const ACTIVITY_CANVAS_NODE_WIDTH = 240
export const ACTIVITY_CANVAS_NODE_HEIGHT = 92

/** Stable palette for agent monograms — distinct from status fills. */
export const AGENT_STRIPE_COLOURS = [
  '#38bdf8', // sky
  '#a78bfa', // violet
  '#f472b6', // pink
  '#34d399', // emerald
  '#fbbf24', // amber
  '#fb7185', // rose
  '#22d3ee', // cyan
  '#c084fc' // purple
] as const

export type ActivityCanvasAgentState =
  | Extract<AgentStatusState, 'working' | 'blocked' | 'waiting' | 'done'>
  | 'interrupted'

export type ActivityCanvasThreadInput = {
  paneKey: string
  paneTitle: string
  workspaceTitle: string
  projectLabel: string
  agentType: AgentType
  agentState: ActivityCanvasAgentState
  agentStateLabel: string
  responsePreview: string
  latestTimestamp: number
  unread: boolean
  /** Orchestration parent pane, when this agent was dispatched by another. */
  parentPaneKey: string | null
  /** Optional monogram override; otherwise assigned by stable index. */
  monogram?: string
}

export type ActivityCanvasAgentLook = {
  monogram: string
  colour: string
  index: number
}

export type ActivityCanvasNode = {
  id: string
  x: number
  y: number
  width: number
  height: number
  isolated: boolean
  thread: ActivityCanvasThreadInput
  agent: ActivityCanvasAgentLook
}

export type ActivityCanvasEdge = {
  id: string
  sourceId: string
  targetId: string
  /** Pixel geometry after layout. */
  path: string
}

export type ActivityCanvasCluster = {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
}

export type ActivityCanvasLayout = {
  nodes: ActivityCanvasNode[]
  edges: ActivityCanvasEdge[]
  clusters: ActivityCanvasCluster[]
  width: number
  height: number
  linkedCount: number
  isolatedCount: number
}
