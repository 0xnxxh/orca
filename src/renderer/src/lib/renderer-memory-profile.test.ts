import { afterEach, describe, expect, it } from 'vitest'
import {
  collectRendererMemoryProfileCounts,
  registerRendererMemoryProfileContributor,
  summarizeStateCollectionSizes
} from './renderer-memory-profile'

const unregisters: (() => void)[] = []

function register(name: string, contributor: () => Record<string, number>): void {
  unregisters.push(registerRendererMemoryProfileContributor(name, contributor))
}

afterEach(() => {
  while (unregisters.length > 0) {
    unregisters.pop()?.()
  }
})

describe('collectRendererMemoryProfileCounts', () => {
  it('namespaces contributor counts and keeps only finite numbers', () => {
    register('store', () => ({ worktrees: 40, junk: Number.NaN }))
    register('terminals', () => ({ panes: 7 }))

    expect(collectRendererMemoryProfileCounts()).toEqual({
      'store.worktrees': 40,
      'terminals.panes': 7
    })
  })

  it('contains a throwing contributor instead of failing collection', () => {
    register('broken', () => {
      throw new Error('boom')
    })
    register('store', () => ({ worktrees: 3 }))

    expect(collectRendererMemoryProfileCounts()).toEqual({
      'broken.error': 1,
      'store.worktrees': 3
    })
  })

  it('unregisters cleanly', () => {
    const unregister = registerRendererMemoryProfileContributor('store', () => ({ a: 1 }))
    unregister()
    expect(collectRendererMemoryProfileCounts()).toEqual({})
  })

  it('caps a runaway contributor instead of bloating the breadcrumb', () => {
    register('runaway', () =>
      Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`key${index}`, index + 1]))
    )

    expect(Object.keys(collectRendererMemoryProfileCounts())).toHaveLength(32)
  })

  it('stops reading a runaway contributor after the output budget', () => {
    let reads = 0
    const contribution = Object.fromEntries(
      Array.from({ length: 500 }, (_, index) => [
        `key${index}`,
        {
          enumerable: true,
          get: () => {
            reads += 1
            return index
          }
        }
      ])
    )
    const counts = Object.defineProperties({}, contribution) as Record<string, number>
    register('runaway', () => counts)

    expect(Object.keys(collectRendererMemoryProfileCounts())).toHaveLength(32)
    expect(reads).toBe(32)
  })
})

describe('summarizeStateCollectionSizes', () => {
  it('reports the largest collections first, capped at the limit', () => {
    const state = {
      worktrees: Array.from({ length: 50 }, () => 0),
      agentStatuses: new Map([['a', 1]]),
      tabs: new Set([1, 2, 3]),
      metaById: { a: 1, b: 2 },
      label: 'not-a-collection',
      count: 9
    }

    expect(summarizeStateCollectionSizes(state, 2)).toEqual({
      worktrees: 50,
      tabs: 3
    })
  })

  it('skips empty collections and non-objects', () => {
    expect(summarizeStateCollectionSizes({ empty: [], none: null }, 5)).toEqual({})
    expect(summarizeStateCollectionSizes(null, 5)).toEqual({})
  })
})
