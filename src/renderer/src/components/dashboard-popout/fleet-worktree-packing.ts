export const FLEET_WORKTREE_GAP = 10

const PACKING_ANGLE_STEPS = 72
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
  neighborDistance: number
}

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

function worktreesOverlap(
  candidate: Pick<PackableWorktree, 'x' | 'y' | 'radius'>,
  placed: PackableWorktree[]
): boolean {
  return placed.some(
    (worktree) =>
      Math.hypot(candidate.x - worktree.x, candidate.y - worktree.y) <
      candidate.radius + worktree.radius + FLEET_WORKTREE_GAP - SCORE_TOLERANCE
  )
}

function comparePackingScores(a: PackingCandidate, b: PackingCandidate): number {
  const aScore = [a.enclosingRadius, a.distanceFromCenter, a.neighborDistance]
  const bScore = [b.enclosingRadius, b.distanceFromCenter, b.neighborDistance]
  for (const [index, score] of aScore.entries()) {
    if (Math.abs(score - bScore[index]) > SCORE_TOLERANCE) {
      return score - bScore[index]
    }
  }
  return 0
}

function placePackedWorktree(worktree: PackableWorktree, placed: PackableWorktree[]): void {
  const currentRadius = Math.max(
    0,
    ...placed.map((candidate) => Math.hypot(candidate.x, candidate.y) + candidate.radius)
  )
  let best: PackingCandidate | undefined

  for (const anchor of placed) {
    const orbit = anchor.radius + worktree.radius + FLEET_WORKTREE_GAP
    const angleOffset = hashFraction(`${worktree.id}:${anchor.id}`) * Math.PI * 2
    for (let step = 0; step < PACKING_ANGLE_STEPS; step += 1) {
      const angle = angleOffset + (step / PACKING_ANGLE_STEPS) * Math.PI * 2
      const x = anchor.x + Math.cos(angle) * orbit
      const y = anchor.y + Math.sin(angle) * orbit
      if (worktreesOverlap({ x, y, radius: worktree.radius }, placed)) {
        continue
      }
      const distanceFromCenter = Math.hypot(x, y)
      const candidate = {
        x,
        y,
        enclosingRadius: Math.max(currentRadius, distanceFromCenter + worktree.radius),
        distanceFromCenter,
        neighborDistance: placed.reduce(
          (sum, other) => sum + Math.hypot(x - other.x, y - other.y),
          0
        )
      }
      if (!best || comparePackingScores(candidate, best) < 0) {
        best = candidate
      }
    }
  }

  worktree.x =
    best?.x ??
    Math.max(...placed.map((candidate) => candidate.x + candidate.radius)) +
      worktree.radius +
      FLEET_WORKTREE_GAP
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

export function packFleetWorktrees<T extends PackableWorktree>(worktrees: T[]): T[] {
  const packed = [...worktrees].sort((a, b) => b.radius - a.radius || compareStable(a.id, b.id))
  for (const [index, worktree] of packed.entries()) {
    if (index > 0) {
      placePackedWorktree(worktree, packed.slice(0, index))
    }
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
