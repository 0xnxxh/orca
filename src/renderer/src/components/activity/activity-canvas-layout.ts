/**
 * Pure layout for the Activity canvas prototype.
 *
 * Inspired by orca-viz's DAG canvas: status keeps the hue, agent identity is a
 * monogram + left stripe, and parent→child edges come from orchestration
 * `parentPaneKey` when present. Agents with no edges pack into an isolated grid
 * (the common case outside an active orchestration run).
 */

import {
  ACTIVITY_CANVAS_NODE_HEIGHT,
  ACTIVITY_CANVAS_NODE_WIDTH,
  AGENT_STRIPE_COLOURS,
  type ActivityCanvasAgentLook,
  type ActivityCanvasCluster,
  type ActivityCanvasEdge,
  type ActivityCanvasLayout,
  type ActivityCanvasNode,
  type ActivityCanvasThreadInput
} from './activity-canvas-types'

export type {
  ActivityCanvasAgentLook,
  ActivityCanvasAgentState,
  ActivityCanvasCluster,
  ActivityCanvasEdge,
  ActivityCanvasLayout,
  ActivityCanvasNode,
  ActivityCanvasThreadInput
} from './activity-canvas-types'
export {
  ACTIVITY_CANVAS_NODE_HEIGHT,
  ACTIVITY_CANVAS_NODE_WIDTH,
  AGENT_STRIPE_COLOURS
} from './activity-canvas-types'

const NODE_GAP_X = 48
const NODE_GAP_Y = 56
const ISOLATED_GAP_X = 28
const ISOLATED_GAP_Y = 28
const ISOLATED_COLUMNS = 3
const TREE_ROOT_GAP_X = 80
const CANVAS_PAD = 48

export function agentLookAt(index: number): ActivityCanvasAgentLook {
  const colour = AGENT_STRIPE_COLOURS[index % AGENT_STRIPE_COLOURS.length]!
  return {
    monogram: `A${index + 1}`,
    colour,
    index
  }
}

function hashPaneKey(paneKey: string): number {
  let hash = 0
  for (let i = 0; i < paneKey.length; i++) {
    hash = (hash * 31 + paneKey.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/**
 * Assign monograms deterministically: coordinators first (no parent in set),
 * then children in stable paneKey order so A1/A2 stay stable across re-layouts.
 */
export function assignAgentLooks(
  threads: ActivityCanvasThreadInput[]
): Map<string, ActivityCanvasAgentLook> {
  const paneKeys = new Set(threads.map((t) => t.paneKey))
  const roots = threads
    .filter((t) => !t.parentPaneKey || !paneKeys.has(t.parentPaneKey))
    .sort((a, b) => a.paneKey.localeCompare(b.paneKey))
  const children = threads
    .filter((t) => t.parentPaneKey && paneKeys.has(t.parentPaneKey))
    .sort((a, b) => a.paneKey.localeCompare(b.paneKey))
  const ordered = [...roots, ...children]
  const looks = new Map<string, ActivityCanvasAgentLook>()
  ordered.forEach((thread, index) => {
    const base = agentLookAt(index)
    looks.set(thread.paneKey, {
      ...base,
      monogram: thread.monogram ?? base.monogram
    })
  })
  return looks
}

type ForestNode = {
  thread: ActivityCanvasThreadInput
  children: ForestNode[]
}

type ForestEdge = { sourceId: string; targetId: string }

function buildForest(threads: ActivityCanvasThreadInput[]): {
  roots: ForestNode[]
  isolated: ActivityCanvasThreadInput[]
  edges: ForestEdge[]
} {
  const byKey = new Map(threads.map((t) => [t.paneKey, t]))
  const childIds = new Set<string>()
  const edges: ForestEdge[] = []

  for (const thread of threads) {
    const parent = thread.parentPaneKey
    if (parent && byKey.has(parent) && parent !== thread.paneKey) {
      childIds.add(thread.paneKey)
      edges.push({ sourceId: parent, targetId: thread.paneKey })
    }
  }

  // Why: a node is "linked" if it participates in any edge; pure singletons
  // pack into the isolated grid so a flat agent list does not look like a
  // broken empty DAG (orca-viz SPEC §7.5).
  const linkedIds = new Set<string>()
  for (const edge of edges) {
    linkedIds.add(edge.sourceId)
    linkedIds.add(edge.targetId)
  }

  const childrenByParent = new Map<string, ActivityCanvasThreadInput[]>()
  for (const edge of edges) {
    const list = childrenByParent.get(edge.sourceId) ?? []
    const child = byKey.get(edge.targetId)
    if (child) {
      list.push(child)
    }
    childrenByParent.set(edge.sourceId, list)
  }

  function toForestNode(thread: ActivityCanvasThreadInput): ForestNode {
    const kids = (childrenByParent.get(thread.paneKey) ?? [])
      .slice()
      .sort((a, b) => a.paneKey.localeCompare(b.paneKey))
      .map(toForestNode)
    return { thread, children: kids }
  }

  const roots: ForestNode[] = []
  const isolated: ActivityCanvasThreadInput[] = []

  for (const thread of threads) {
    if (!linkedIds.has(thread.paneKey)) {
      isolated.push(thread)
      continue
    }
    if (!childIds.has(thread.paneKey)) {
      roots.push(toForestNode(thread))
    }
  }

  roots.sort((a, b) => a.thread.paneKey.localeCompare(b.thread.paneKey))
  isolated.sort((a, b) => b.latestTimestamp - a.latestTimestamp)

  return { roots, isolated, edges }
}

type Placed = { id: string; x: number; y: number; depth: number }

/** Recursive tidy tree: children centered under parent, left-to-right siblings. */
function placeTree(
  node: ForestNode,
  depth: number,
  nextLeafX: { value: number },
  placed: Placed[]
): { x: number; width: number } {
  if (node.children.length === 0) {
    const x = nextLeafX.value
    nextLeafX.value += ACTIVITY_CANVAS_NODE_WIDTH + NODE_GAP_X
    placed.push({
      id: node.thread.paneKey,
      x,
      y: depth * (ACTIVITY_CANVAS_NODE_HEIGHT + NODE_GAP_Y),
      depth
    })
    return { x, width: ACTIVITY_CANVAS_NODE_WIDTH }
  }

  const childBoxes = node.children.map((child) => placeTree(child, depth + 1, nextLeafX, placed))
  const first = childBoxes.at(0)!
  const last = childBoxes.at(-1)!
  const left = first.x
  const right = last.x + last.width
  const x = left + (right - left - ACTIVITY_CANVAS_NODE_WIDTH) / 2
  placed.push({
    id: node.thread.paneKey,
    x,
    y: depth * (ACTIVITY_CANVAS_NODE_HEIGHT + NODE_GAP_Y),
    depth
  })
  return { x: left, width: right - left }
}

function edgePath(
  source: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number; width: number; height: number }
): string {
  const x1 = source.x + source.width / 2
  const y1 = source.y + source.height
  const x2 = target.x + target.width / 2
  const y2 = target.y
  const midY = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
}

export function layoutActivityCanvas(threads: ActivityCanvasThreadInput[]): ActivityCanvasLayout {
  if (threads.length === 0) {
    return {
      nodes: [],
      edges: [],
      clusters: [],
      width: 640,
      height: 400,
      linkedCount: 0,
      isolatedCount: 0
    }
  }

  const looks = assignAgentLooks(threads)
  const { roots, isolated, edges: rawEdges } = buildForest(threads)
  const placed: Placed[] = []
  let cursorX = CANVAS_PAD
  let treeBottom = CANVAS_PAD

  for (const root of roots) {
    const treePlaced: Placed[] = []
    const nextLeafX = { value: 0 }
    placeTree(root, 0, nextLeafX, treePlaced)
    let minX = Infinity
    for (const p of treePlaced) {
      minX = Math.min(minX, p.x)
    }
    const offsetX = cursorX - (Number.isFinite(minX) ? minX : 0)
    for (const p of treePlaced) {
      placed.push({
        ...p,
        x: p.x + offsetX,
        y: p.y + CANVAS_PAD
      })
      treeBottom = Math.max(treeBottom, p.y + CANVAS_PAD + ACTIVITY_CANVAS_NODE_HEIGHT)
    }
    const treeWidth = nextLeafX.value
    cursorX += treeWidth + TREE_ROOT_GAP_X
  }

  const linkedNodes: ActivityCanvasNode[] = placed.map((p) => {
    const thread = threads.find((t) => t.paneKey === p.id)!
    return {
      id: p.id,
      x: p.x,
      y: p.y,
      width: ACTIVITY_CANVAS_NODE_WIDTH,
      height: ACTIVITY_CANVAS_NODE_HEIGHT,
      isolated: false,
      thread,
      agent: looks.get(p.id) ?? agentLookAt(hashPaneKey(p.id) % AGENT_STRIPE_COLOURS.length)
    }
  })

  // Isolated grid sits below the forest (or at origin when there is no forest).
  const isolatedOriginY = linkedNodes.length > 0 ? treeBottom + NODE_GAP_Y + 24 : CANVAS_PAD
  const isolatedOriginX = CANVAS_PAD
  const isolatedNodes: ActivityCanvasNode[] = isolated.map((thread, index) => {
    const col = index % ISOLATED_COLUMNS
    const row = Math.floor(index / ISOLATED_COLUMNS)
    return {
      id: thread.paneKey,
      x: isolatedOriginX + col * (ACTIVITY_CANVAS_NODE_WIDTH + ISOLATED_GAP_X),
      y: isolatedOriginY + row * (ACTIVITY_CANVAS_NODE_HEIGHT + ISOLATED_GAP_Y),
      width: ACTIVITY_CANVAS_NODE_WIDTH,
      height: ACTIVITY_CANVAS_NODE_HEIGHT,
      isolated: true,
      thread,
      agent: looks.get(thread.paneKey) ?? agentLookAt(index)
    }
  })

  const nodes = [...linkedNodes, ...isolatedNodes]
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  const edges: ActivityCanvasEdge[] = rawEdges
    .map((edge) => {
      const source = nodeById.get(edge.sourceId)
      const target = nodeById.get(edge.targetId)
      if (!source || !target) {
        return null
      }
      return {
        id: `${edge.sourceId}->${edge.targetId}`,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        path: edgePath(source, target)
      }
    })
    .filter((e): e is ActivityCanvasEdge => e !== null)

  const clusters: ActivityCanvasCluster[] = []
  if (isolatedNodes.length > 0) {
    const xs = isolatedNodes.map((n) => n.x)
    const ys = isolatedNodes.map((n) => n.y)
    const minX = Math.min(...xs) - 16
    const minY = Math.min(...ys) - 36
    const maxX = Math.max(...isolatedNodes.map((n) => n.x + n.width)) + 16
    const maxY = Math.max(...isolatedNodes.map((n) => n.y + n.height)) + 16
    clusters.push({
      id: 'isolated',
      label: `Isolated agents (${isolatedNodes.length})`,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    })
  }

  let maxX = CANVAS_PAD + 400
  let maxY = CANVAS_PAD + 280
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + n.width + CANVAS_PAD)
    maxY = Math.max(maxY, n.y + n.height + CANVAS_PAD)
  }
  for (const c of clusters) {
    maxX = Math.max(maxX, c.x + c.width + CANVAS_PAD)
    maxY = Math.max(maxY, c.y + c.height + CANVAS_PAD)
  }

  return {
    nodes,
    edges,
    clusters,
    width: maxX,
    height: maxY,
    linkedCount: linkedNodes.length,
    isolatedCount: isolatedNodes.length
  }
}
