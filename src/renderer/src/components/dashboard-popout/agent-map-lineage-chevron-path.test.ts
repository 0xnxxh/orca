import { describe, expect, it } from 'vitest'
import { agentMapDirectLineageChevronPath } from './agent-map-lineage-chevron-path'

describe('agentMapDirectLineageChevronPath', () => {
  it('runs every chevron directly from the parent toward the child', () => {
    const path = agentMapDirectLineageChevronPath(
      { x: 0, y: 0, radius: 4 },
      { x: 40, y: 40, radius: 4 }
    )
    const tips = [...path.matchAll(/M [-\d.]+ [-\d.]+ L ([-\d.]+) ([-\d.]+) L/g)].map((match) => ({
      x: Number(match[1]),
      y: Number(match[2])
    }))

    expect(tips.length).toBeGreaterThan(1)
    expect(tips.every((tip) => tip.x === tip.y)).toBe(true)
    expect(tips.at(-1)?.x).toBeGreaterThan(tips[0].x)
  })
})
