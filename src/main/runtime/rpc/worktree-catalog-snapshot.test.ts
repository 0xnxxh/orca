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
