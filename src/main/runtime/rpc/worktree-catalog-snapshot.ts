import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type {
  RuntimeWorktreePsConditionalResult,
  RuntimeWorktreePsResult
} from '../../../shared/runtime-types'

type CachedWorktreeCatalog = {
  limit: number | undefined
  result: RuntimeWorktreePsResult
  snapshotId: string
}

export class WorktreeCatalogSnapshotCache {
  private readonly runtimeScope = randomUUID()
  private sequence = 0
  private cached: CachedWorktreeCatalog | null = null

  resolve(
    limit: number | undefined,
    result: RuntimeWorktreePsResult,
    afterSnapshotId: string | null
  ): RuntimeWorktreePsConditionalResult {
    const cached = this.cached
    if (cached !== null && cached.limit === limit && isDeepStrictEqual(cached.result, result)) {
      if (afterSnapshotId === cached.snapshotId) {
        return { unchanged: true, snapshotId: cached.snapshotId }
      }
      return { ...result, snapshotId: cached.snapshotId }
    }

    const snapshotId = `${this.runtimeScope}:${++this.sequence}`
    this.cached = { limit, result, snapshotId }
    return { ...result, snapshotId }
  }
}

const snapshotsByRuntime = new WeakMap<object, WorktreeCatalogSnapshotCache>()

export function resolveWorktreeCatalogSnapshot(
  runtime: object,
  limit: number | undefined,
  result: RuntimeWorktreePsResult,
  afterSnapshotId: string | null
): RuntimeWorktreePsConditionalResult {
  let snapshots = snapshotsByRuntime.get(runtime)
  if (!snapshots) {
    snapshots = new WorktreeCatalogSnapshotCache()
    snapshotsByRuntime.set(runtime, snapshots)
  }
  return snapshots.resolve(limit, result, afterSnapshotId)
}
