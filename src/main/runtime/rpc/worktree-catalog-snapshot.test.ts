import { describe, expect, it } from 'vitest'
import type { RuntimeWorktreePsResult } from '../../../shared/runtime-types'
import { WorktreeCatalogSnapshotCache } from './worktree-catalog-snapshot'

function result(totalCount: number): RuntimeWorktreePsResult {
  return { worktrees: [], totalCount, truncated: false }
}

describe('WorktreeCatalogSnapshotCache', () => {
  it('returns unchanged only when the caller owns the exact completed snapshot', () => {
    const snapshots = new WorktreeCatalogSnapshotCache()
    const first = snapshots.resolve(10_000, result(1), null)
    expect(first).toMatchObject({ totalCount: 1 })
    expect('snapshotId' in first).toBe(true)

    const snapshotId = first.snapshotId
    expect(snapshots.resolve(10_000, result(1), snapshotId)).toEqual({
      unchanged: true,
      snapshotId
    })
    expect(snapshots.resolve(10_000, result(1), 'unknown')).toEqual({
      ...result(1),
      snapshotId
    })
  })

  it('issues a new snapshot for changed content or a different limit', () => {
    const snapshots = new WorktreeCatalogSnapshotCache()
    const first = snapshots.resolve(10_000, result(1), null)
    const changed = snapshots.resolve(10_000, result(2), first.snapshotId)
    const differentLimit = snapshots.resolve(200, result(2), changed.snapshotId)

    expect(changed.snapshotId).not.toBe(first.snapshotId)
    expect(differentLimit.snapshotId).not.toBe(changed.snapshotId)
  })

  it('keeps alternating conditional limits independent', () => {
    const snapshots = new WorktreeCatalogSnapshotCache()
    const wide = snapshots.resolve(10_000, result(2), null)
    const narrow = snapshots.resolve(200, result(1), null)

    expect(snapshots.resolve(10_000, result(2), wide.snapshotId)).toEqual({
      unchanged: true,
      snapshotId: wide.snapshotId
    })
    expect(snapshots.resolve(200, result(1), narrow.snapshotId)).toEqual({
      unchanged: true,
      snapshotId: narrow.snapshotId
    })
  })

  it('bounds snapshots retained for distinct limits', () => {
    const snapshots = new WorktreeCatalogSnapshotCache()
    const first = snapshots.resolve(1, result(1), null)
    for (let limit = 2; limit <= 9; limit += 1) {
      snapshots.resolve(limit, result(limit), null)
    }

    const replaced = snapshots.resolve(1, result(1), first.snapshotId)
    expect(replaced).not.toHaveProperty('unchanged')
    expect(replaced.snapshotId).not.toBe(first.snapshotId)
  })

  it('retains recently used limits when the cache is full', () => {
    const snapshots = new WorktreeCatalogSnapshotCache()
    const ids = Array.from({ length: 8 }, (_, index) => {
      const limit = index + 1
      return snapshots.resolve(limit, result(limit), null).snapshotId
    })

    snapshots.resolve(1, result(1), ids[0])
    snapshots.resolve(9, result(9), null)

    expect(snapshots.resolve(1, result(1), ids[0])).toHaveProperty('unchanged', true)
    expect(snapshots.resolve(2, result(2), ids[1])).not.toHaveProperty('unchanged')
  })

  it('repairs completion-order cache replacement with a full response', () => {
    const snapshots = new WorktreeCatalogSnapshotCache()
    const older = snapshots.resolve(10_000, result(1), null)
    const newer = snapshots.resolve(10_000, result(2), older.snapshotId)
    snapshots.resolve(10_000, result(1), older.snapshotId)

    const repaired = snapshots.resolve(10_000, result(2), newer.snapshotId)
    expect(repaired).toMatchObject({ totalCount: 2 })
    expect(repaired).not.toHaveProperty('unchanged')
  })

  it('scopes snapshot ids to one runtime cache', () => {
    const left = new WorktreeCatalogSnapshotCache().resolve(10_000, result(1), null)
    const right = new WorktreeCatalogSnapshotCache().resolve(10_000, result(1), null)

    expect(left.snapshotId).not.toBe(right.snapshotId)
  })
})
