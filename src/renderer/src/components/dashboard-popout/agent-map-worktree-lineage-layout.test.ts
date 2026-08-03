import { describe, expect, it } from 'vitest'
import { AGENT_MAP_WORKTREE_GAP } from './agent-map-worktree-packing'
import { layoutAgentMapWorktreeLineage } from './agent-map-worktree-lineage-layout'

function buildChain(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `worktree-${index.toString().padStart(4, '0')}`,
    parentId: index === 0 ? undefined : `worktree-${(index - 1).toString().padStart(4, '0')}`,
    radius: 32,
    x: 0,
    y: 0
  }))
}

function buildComb(spineCount: number) {
  const worktrees: ReturnType<typeof buildChain> = []
  for (let index = 0; index < spineCount; index += 1) {
    const suffix = index.toString().padStart(4, '0')
    worktrees.push({
      id: `spine-${suffix}`,
      parentId: index === 0 ? undefined : `spine-${(index - 1).toString().padStart(4, '0')}`,
      radius: 32,
      x: 0,
      y: 0
    })
    if (index < spineCount - 1) {
      worktrees.push({
        id: `leaf-${suffix}`,
        parentId: `spine-${suffix}`,
        radius: 24,
        x: 0,
        y: 0
      })
    }
  }
  return worktrees
}

function layoutWithNumericMapSetCount(worktrees: ReturnType<typeof buildChain>) {
  const set = Map.prototype.set
  let numericMapSets = 0
  Map.prototype.set = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (typeof key === 'number') {
      numericMapSets += 1
    }
    return Reflect.apply(set, this, [key, value])
  } as typeof Map.prototype.set
  try {
    return { layout: layoutAgentMapWorktreeLineage(worktrees), numericMapSets }
  } finally {
    Map.prototype.set = set
  }
}

function layoutWithWorktreePushCount(count: number) {
  const push = Array.prototype.push
  let worktreePushes = 0
  Array.prototype.push = function (...items: unknown[]): number {
    worktreePushes += items.filter(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        typeof item.id === 'string' &&
        item.id.startsWith('worktree-')
    ).length
    return Reflect.apply(push, this, items)
  }
  try {
    return {
      layout: layoutAgentMapWorktreeLineage(buildChain(count)),
      worktreePushes
    }
  } finally {
    Array.prototype.push = push
  }
}

describe('layoutAgentMapWorktreeLineage', () => {
  it('preserves the legacy coordinates for branched and linear families', () => {
    const layout = layoutAgentMapWorktreeLineage([
      { id: 'root', x: 0, y: 0, radius: 40 },
      { id: 'child-a', parentId: 'root', x: 0, y: 0, radius: 30 },
      { id: 'grandchild-a', parentId: 'child-a', x: 0, y: 0, radius: 25 },
      { id: 'child-b', parentId: 'root', x: 0, y: 0, radius: 45 },
      { id: 'second-root', x: 0, y: 0, radius: 35 },
      { id: 'second-child', parentId: 'second-root', x: 0, y: 0, radius: 20 }
    ])

    expect(layout).toEqual([
      {
        id: 'child-a',
        parentId: 'root',
        radius: 30,
        x: -4.33242478827686,
        y: 47.79022515386755
      },
      {
        id: 'child-b',
        parentId: 'root',
        radius: 45,
        x: 79.07393510462774,
        y: 194.80695213220156
      },
      {
        id: 'grandchild-a',
        parentId: 'child-a',
        radius: 25,
        x: -4.33242478827686,
        y: 144.79022515386754
      },
      { id: 'root', radius: 40, x: 21.870755158175434, y: -64.20977484613245 },
      {
        id: 'second-child',
        parentId: 'second-root',
        radius: 20,
        x: -121.42967792073006,
        y: -79.34629927692441
      },
      {
        id: 'second-root',
        radius: 35,
        x: -121.42967792073006,
        y: -176.3462992769244
      }
    ])
  })

  it('flattens a 1,000-worktree lineage once', () => {
    const { layout, worktreePushes } = layoutWithWorktreePushCount(1_000)

    expect(layout).toHaveLength(1_000)
    expect(worktreePushes).toBeLessThan(5_000)
    for (let index = 1; index < layout.length; index += 1) {
      expect(layout[index].y).toBeGreaterThan(layout[index - 1].y)
      expect(layout[index].y - layout[index - 1].y).toBeGreaterThanOrEqual(
        layout[index].radius + layout[index - 1].radius + AGENT_MAP_WORKTREE_GAP
      )
    }
  })

  it.each([
    [399, 200],
    [999, 500]
  ])('avoids spatial-grid expansion for a %i-worktree comb', (expectedCount, spineCount) => {
    const worktrees = buildComb(spineCount)
    const { layout, numericMapSets } = layoutWithNumericMapSetCount(worktrees)

    expect(layout).toHaveLength(expectedCount)
    expect(numericMapSets).toBeLessThan(10)
    expect(layoutAgentMapWorktreeLineage(worktrees)).toEqual(layout)
  })
})
