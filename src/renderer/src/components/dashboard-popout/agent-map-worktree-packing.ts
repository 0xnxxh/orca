export const AGENT_MAP_WORKTREE_GAP = 10

const PACKING_ANGLE_STEPS = 72
const MAX_PACKING_CANDIDATE_ANCHORS = 128
const MAX_DIRECT_OVERLAP_WORKTREES = 4
const PACKING_GRID_SIZE = 128
const SCORE_TOLERANCE = 0.001
const CENTER_DIRECTIONS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1]
] as const

type PackableWorktree = {
  id: string
  x: number
  y: number
  radius: number
}

type PackingCandidate = {
  x: number
  y: number
  enclosingRadius: number
  distanceFromCenter: number
  neighborDistance?: number
}

type PackingSpatialIndex = Map<number, Map<number, PackableWorktree[]>>

function compareStable(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function hashFraction(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 0xffffffff
}

function addToPackingSpatialIndex(index: PackingSpatialIndex, worktree: PackableWorktree): void {
  const left = Math.floor((worktree.x - worktree.radius) / PACKING_GRID_SIZE)
  const right = Math.floor((worktree.x + worktree.radius) / PACKING_GRID_SIZE)
  const top = Math.floor((worktree.y - worktree.radius) / PACKING_GRID_SIZE)
  const bottom = Math.floor((worktree.y + worktree.radius) / PACKING_GRID_SIZE)
  for (let x = left; x <= right; x += 1) {
    let column = index.get(x)
    if (!column) {
      column = new Map()
      index.set(x, column)
    }
    for (let y = top; y <= bottom; y += 1) {
      const cell = column.get(y)
      if (cell) {
        cell.push(worktree)
      } else {
        column.set(y, [worktree])
      }
    }
  }
}

function indexedWorktreesOverlap(
  candidate: Pick<PackableWorktree, 'x' | 'y' | 'radius'>,
  index: PackingSpatialIndex
): boolean {
  const searchRadius = candidate.radius + AGENT_MAP_WORKTREE_GAP
  const left = Math.floor((candidate.x - searchRadius) / PACKING_GRID_SIZE)
  const right = Math.floor((candidate.x + searchRadius) / PACKING_GRID_SIZE)
  const top = Math.floor((candidate.y - searchRadius) / PACKING_GRID_SIZE)
  const bottom = Math.floor((candidate.y + searchRadius) / PACKING_GRID_SIZE)
  const checked = new Set<PackableWorktree>()
  for (let x = left; x <= right; x += 1) {
    const column = index.get(x)
    if (!column) {
      continue
    }
    for (let y = top; y <= bottom; y += 1) {
      for (const worktree of column.get(y) ?? []) {
        if (checked.has(worktree)) {
          continue
        }
        checked.add(worktree)
        if (
          Math.hypot(candidate.x - worktree.x, candidate.y - worktree.y) <
          candidate.radius + worktree.radius + AGENT_MAP_WORKTREE_GAP - SCORE_TOLERANCE
        ) {
          return true
        }
      }
    }
  }
  return false
}

function placedWorktreesOverlap(
  candidate: Pick<PackableWorktree, 'x' | 'y' | 'radius'>,
  placed: PackableWorktree[]
): boolean {
  return placed.some(
    (worktree) =>
      Math.hypot(candidate.x - worktree.x, candidate.y - worktree.y) <
      candidate.radius + worktree.radius + AGENT_MAP_WORKTREE_GAP - SCORE_TOLERANCE
  )
}

function comparePackingScores(
  a: PackingCandidate,
  b: PackingCandidate,
  placed: PackableWorktree[]
): number {
  for (const key of ['enclosingRadius', 'distanceFromCenter'] as const) {
    if (Math.abs(a[key] - b[key]) > SCORE_TOLERANCE) {
      return a[key] - b[key]
    }
  }
  a.neighborDistance ??= placed.reduce(
    (sum, other) => sum + Math.hypot(a.x - other.x, a.y - other.y),
    0
  )
  b.neighborDistance ??= placed.reduce(
    (sum, other) => sum + Math.hypot(b.x - other.x, b.y - other.y),
    0
  )
  return Math.abs(a.neighborDistance - b.neighborDistance) > SCORE_TOLERANCE
    ? a.neighborDistance - b.neighborDistance
    : 0
}

function compareBoundaryAnchors(a: PackableWorktree, b: PackableWorktree): number {
  return (
    Math.hypot(b.x, b.y) + b.radius - (Math.hypot(a.x, a.y) + a.radius) || compareStable(a.id, b.id)
  )
}

function addBoundaryAnchor(boundaryAnchors: PackableWorktree[], worktree: PackableWorktree): void {
  let low = 0
  let high = boundaryAnchors.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (compareBoundaryAnchors(worktree, boundaryAnchors[middle]) < 0) {
      high = middle
    } else {
      low = middle + 1
    }
  }
  boundaryAnchors.splice(low, 0, worktree)
  if (boundaryAnchors.length > MAX_PACKING_CANDIDATE_ANCHORS) {
    boundaryAnchors.pop()
  }
}

function placePackedWorktree(
  worktree: PackableWorktree,
  placed: PackableWorktree[],
  boundaryAnchors: PackableWorktree[],
  spatialIndex: PackingSpatialIndex | null,
  currentRadius: number
): void {
  let best: PackingCandidate | undefined

  const anchors = placed.length <= MAX_PACKING_CANDIDATE_ANCHORS ? placed : boundaryAnchors
  for (const anchor of anchors) {
    const orbit = anchor.radius + worktree.radius + AGENT_MAP_WORKTREE_GAP
    const angleOffset = hashFraction(`${worktree.id}:${anchor.id}`) * Math.PI * 2
    for (let step = 0; step < PACKING_ANGLE_STEPS; step += 1) {
      const angle = angleOffset + (step / PACKING_ANGLE_STEPS) * Math.PI * 2
      const x = anchor.x + Math.cos(angle) * orbit
      const y = anchor.y + Math.sin(angle) * orbit
      const overlapCandidate = { x, y, radius: worktree.radius }
      if (
        spatialIndex
          ? indexedWorktreesOverlap(overlapCandidate, spatialIndex)
          : placedWorktreesOverlap(overlapCandidate, placed)
      ) {
        continue
      }
      const distanceFromCenter = Math.hypot(x, y)
      const candidate = {
        x,
        y,
        enclosingRadius: Math.max(currentRadius, distanceFromCenter + worktree.radius),
        distanceFromCenter
      }
      if (!best || comparePackingScores(candidate, best, placed) < 0) {
        best = candidate
      }
    }
  }

  worktree.x =
    best?.x ??
    Math.max(...placed.map((candidate) => candidate.x + candidate.radius)) +
      worktree.radius +
      AGENT_MAP_WORKTREE_GAP
  worktree.y = best?.y ?? 0
}

function enclosingRadius(worktrees: PackableWorktree[], x: number, y: number): number {
  return Math.max(
    ...worktrees.map((worktree) => Math.hypot(worktree.x - x, worktree.y - y) + worktree.radius)
  )
}

function findEnclosingCenter(
  worktrees: PackableWorktree[],
  bounds: { left: number; right: number; top: number; bottom: number }
): { x: number; y: number } {
  let x = (bounds.left + bounds.right) / 2
  let y = (bounds.top + bounds.bottom) / 2
  let radius = enclosingRadius(worktrees, x, y)
  let step = Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) / 4

  while (step > SCORE_TOLERANCE) {
    let improved = false
    for (const [dx, dy] of CENTER_DIRECTIONS) {
      const candidateX = x + dx * step
      const candidateY = y + dy * step
      const candidateRadius = enclosingRadius(worktrees, candidateX, candidateY)
      if (candidateRadius < radius - SCORE_TOLERANCE) {
        x = candidateX
        y = candidateY
        radius = candidateRadius
        improved = true
      }
    }
    if (!improved) {
      step /= 2
    }
  }
  return { x, y }
}

export function packAgentMapWorktrees<T extends PackableWorktree>(worktrees: T[]): T[] {
  const packed = [...worktrees].sort((a, b) => b.radius - a.radius || compareStable(a.id, b.id))
  const placed: PackableWorktree[] = []
  const boundaryAnchors: PackableWorktree[] = []
  const spatialIndex: PackingSpatialIndex | null =
    packed.length > MAX_DIRECT_OVERLAP_WORKTREES ? new Map() : null
  let currentRadius = 0
  for (const worktree of packed) {
    if (placed.length > 0) {
      placePackedWorktree(worktree, placed, boundaryAnchors, spatialIndex, currentRadius)
    }
    placed.push(worktree)
    addBoundaryAnchor(boundaryAnchors, worktree)
    if (spatialIndex) {
      addToPackingSpatialIndex(spatialIndex, worktree)
    }
    currentRadius = Math.max(currentRadius, Math.hypot(worktree.x, worktree.y) + worktree.radius)
  }
  if (packed.length === 0) {
    return packed
  }
  const left = Math.min(...packed.map((worktree) => worktree.x - worktree.radius))
  const right = Math.max(...packed.map((worktree) => worktree.x + worktree.radius))
  const top = Math.min(...packed.map((worktree) => worktree.y - worktree.radius))
  const bottom = Math.max(...packed.map((worktree) => worktree.y + worktree.radius))
  const center = findEnclosingCenter(packed, { left, right, top, bottom })
  for (const worktree of packed) {
    worktree.x -= center.x
    worktree.y -= center.y
  }
  return packed.sort((a, b) => compareStable(a.id, b.id))
}
