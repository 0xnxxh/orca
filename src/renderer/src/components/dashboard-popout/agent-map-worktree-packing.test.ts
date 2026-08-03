import { describe, expect, it } from 'vitest'
import { AGENT_MAP_WORKTREE_GAP, packAgentMapWorktrees } from './agent-map-worktree-packing'

function circles(): { id: string; x: number; y: number; radius: number }[] {
  return Array.from({ length: 80 }, (_, index) => ({
    id: `worktree-${index.toString().padStart(2, '0')}`,
    x: 0,
    y: 0,
    radius: 28 + (index % 7) * 13
  }))
}

function measuredCircles(): {
  worktrees: ReturnType<typeof circles>
  coordinateReads: () => number
} {
  let reads = 0
  const worktrees = circles().map(({ id, radius }) => {
    let x = 0
    let y = 0
    return {
      id,
      radius,
      get x() {
        reads += 1
        return x
      },
      set x(value: number) {
        x = value
      },
      get y() {
        reads += 1
        return y
      },
      set y(value: number) {
        y = value
      }
    }
  })
  return { worktrees, coordinateReads: () => reads }
}

describe('packAgentMapWorktrees', () => {
  it('keeps variable-radius rings deterministic and non-overlapping', () => {
    const first = packAgentMapWorktrees(circles())
    const second = packAgentMapWorktrees(circles())

    expect(second).toEqual(first)
    for (const [index, worktree] of first.entries()) {
      for (const other of first.slice(index + 1)) {
        expect(Math.hypot(worktree.x - other.x, worktree.y - other.y)).toBeGreaterThanOrEqual(
          worktree.radius + other.radius + AGENT_MAP_WORKTREE_GAP - 0.001
        )
      }
    }
  })

  it('bounds deterministic coordinate checks for larger maps', () => {
    const { worktrees, coordinateReads } = measuredCircles()

    packAgentMapWorktrees(worktrees)

    expect(coordinateReads()).toBeLessThan(1_500_000)
  })
})
