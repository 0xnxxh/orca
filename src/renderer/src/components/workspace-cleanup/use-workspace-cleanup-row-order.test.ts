import { describe, expect, it } from 'vitest'
import {
  arrangeWorkspaceCleanupRowsByFrozenOrder,
  createWorkspaceCleanupFrozenRowOrder
} from './use-workspace-cleanup-row-order'

type Row = { worktreeId: string }

const row = (worktreeId: string): Row => ({ worktreeId })
const ids = (rows: readonly Row[]): string[] => rows.map((entry) => entry.worktreeId)

describe('workspace cleanup streaming row order', () => {
  it('keeps existing rows in their frozen slots when streamed values would resort them', () => {
    const order = createWorkspaceCleanupFrozenRowOrder([row('a'), row('b'), row('c')], 'name:asc')

    // The live sort now says c < a < b (values changed mid-stream).
    const arranged = arrangeWorkspaceCleanupRowsByFrozenOrder([row('c'), row('a'), row('b')], order)

    expect(ids(arranged)).toEqual(['a', 'b', 'c'])
  })

  it('appends unseen rows after the frozen ones and keeps them stable on later ticks', () => {
    const order = createWorkspaceCleanupFrozenRowOrder([row('a'), row('b')], 'name:asc')

    const firstTick = arrangeWorkspaceCleanupRowsByFrozenOrder(
      [row('a'), row('d'), row('b'), row('c')],
      order
    )
    expect(ids(firstTick)).toEqual(['a', 'b', 'd', 'c'])

    // A later tick sorting d and c differently must not swap them anymore.
    const secondTick = arrangeWorkspaceCleanupRowsByFrozenOrder(
      [row('c'), row('d'), row('b'), row('a')],
      order
    )
    expect(ids(secondTick)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('holds slots for rows a filter temporarily hides', () => {
    const order = createWorkspaceCleanupFrozenRowOrder([row('a'), row('b'), row('c')], 'name:asc')

    expect(ids(arrangeWorkspaceCleanupRowsByFrozenOrder([row('c'), row('a')], order))).toEqual([
      'a',
      'c'
    ])
    // Un-hiding b restores its original slot between a and c.
    expect(
      ids(arrangeWorkspaceCleanupRowsByFrozenOrder([row('c'), row('b'), row('a')], order))
    ).toEqual(['a', 'b', 'c'])
  })

  it('grows the frozen order from empty during a cold-start stream', () => {
    const order = createWorkspaceCleanupFrozenRowOrder([], 'name:asc')

    expect(ids(arrangeWorkspaceCleanupRowsByFrozenOrder([row('b'), row('d')], order))).toEqual([
      'b',
      'd'
    ])
    // New rows slot after the already-presented ones even when they sort earlier.
    expect(
      ids(arrangeWorkspaceCleanupRowsByFrozenOrder([row('a'), row('b'), row('c'), row('d')], order))
    ).toEqual(['b', 'd', 'a', 'c'])
  })
})
