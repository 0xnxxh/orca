import { describe, expect, it } from 'vitest'
import {
  agentMapDirectLineageChevronPath,
  agentMapLineagePathCacheSize
} from './agent-map-lineage-chevron-path'

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

  it('trims the path to unequal node radii', () => {
    expect(
      agentMapDirectLineageChevronPath({ x: 0, y: 0, radius: 2 }, { x: 20, y: 0, radius: 6 })
    ).toBe('M 4.5 2.25 L 8 0 L 4.5 -2.25')
  })

  it('does not reverse direction when node boundaries overlap', () => {
    expect(
      agentMapDirectLineageChevronPath({ x: 0, y: 0, radius: 10 }, { x: 15, y: 0, radius: 10 })
    ).toBe('M 0 0')
  })

  it('omits a chevron that cannot fit between trimmed node boundaries', () => {
    expect(
      agentMapDirectLineageChevronPath({ x: 0, y: 0, radius: 10 }, { x: 25, y: 0, radius: 10 })
    ).toBe('M 10 0')
  })

  it('caps decorative chevrons on long links', () => {
    const path = agentMapDirectLineageChevronPath(
      { x: 0, y: 0, radius: 0 },
      { x: 10_000, y: 0, radius: 0 }
    )

    expect(path.match(/\bM\b/g)).toHaveLength(256)
  })

  it('keeps the same chevron pitch however far apart the nodes are', () => {
    const pitches = [60, 200, 900].map((distance) => {
      const tips = [
        ...agentMapDirectLineageChevronPath(
          { x: 0, y: 0, radius: 0 },
          { x: distance, y: 0, radius: 0 }
        ).matchAll(/M [-\d.]+ [-\d.]+ L ([-\d.]+) [-\d.]+ L/g)
      ].map((match) => Number(match[1]))

      expect(tips.length).toBeGreaterThan(2)
      return tips.slice(1).map((tip, index) => tip - tips[index])
    })

    expect(pitches.flat().every((pitch) => pitch === 8)).toBe(true)
  })

  it('serves an unmoved edge from cache instead of rebuilding it', () => {
    const parent = { x: 3, y: 5, radius: 20 }
    const child = { x: 903, y: 5, radius: 20 }
    const before = agentMapLineagePathCacheSize()
    const first = agentMapDirectLineageChevronPath(parent, child)
    const afterMiss = agentMapLineagePathCacheSize()
    const second = agentMapDirectLineageChevronPath({ ...parent }, { ...child })

    expect(afterMiss).toBe(before + 1) // first call was a miss
    expect(agentMapLineagePathCacheSize()).toBe(afterMiss) // second stored nothing → hit
    expect(second).toBe(first)
  })

  it('bounds the cache as edges churn', () => {
    const hot = [
      { x: -1, y: -1, radius: 2 },
      { x: -1, y: -400, radius: 2 }
    ] as const
    for (let i = 0; i < 600; i += 1) {
      agentMapDirectLineageChevronPath({ x: i, y: 1_000, radius: 2 }, { x: i, y: 1_200, radius: 2 })
      if (i % 10 === 0) {
        agentMapDirectLineageChevronPath(hot[0], hot[1])
      }
    }

    expect(agentMapLineagePathCacheSize()).toBe(512)
  })
})
