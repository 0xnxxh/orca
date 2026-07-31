import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type {
  RuntimeWorktreePsConditionalResult,
  RuntimeWorktreePsResult
} from '../../../shared/runtime-types'

type CachedWorktreeCatalog = {
  result: RuntimeWorktreePsResult
  snapshotId: string
}

const MAX_CACHED_LIMITS = 8

export class WorktreeCatalogSnapshotCache {
  private readonly runtimeScope = randomUUID()
  private sequence = 0
  private readonly cachedByLimit = new Map<number | undefined, CachedWorktreeCatalog>()

  resolve(
    limit: number | undefined,
    result: RuntimeWorktreePsResult,
    afterSnapshotId: string | null
  ): RuntimeWorktreePsConditionalResult {
    const cached = this.cachedByLimit.get(limit)
    if (cached && isDeepStrictEqual(cached.result, result)) {
      this.cachedByLimit.delete(limit)
      this.cachedByLimit.set(limit, cached)
      if (afterSnapshotId === cached.snapshotId) {
        return { unchanged: true, snapshotId: cached.snapshotId }
      }
      return { ...result, snapshotId: cached.snapshotId }
    }

    const snapshotId = `${this.runtimeScope}:${++this.sequence}`
    this.cachedByLimit.delete(limit)
    this.cachedByLimit.set(limit, { result, snapshotId })
    if (this.cachedByLimit.size > MAX_CACHED_LIMITS) {
      this.cachedByLimit.delete(this.cachedByLimit.keys().next().value)
    }
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
