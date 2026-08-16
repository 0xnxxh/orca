import {
  registerWorkspaceSnapshotPrunesForFile,
  WORKSPACE_SNAPSHOT_PRUNE_PRODUCER_TIMEOUT_MS,
  type WorkspaceSnapshotPruneTarget,
  type WorkspaceSnapshotPruneTombstone
} from './workspace-snapshot-prune-index'

/** Held by a deferred removal batch between its tombstone write and its sidecar flush. */
export const WORKSPACE_SNAPSHOT_PRUNE_FLUSH_HOLDER = 'flush'

/**
 * Owns tombstone lifetime for one sidecar file (STA-4451). A tombstone only has to outlive the
 * writers that could still put the removed row back, so it is retired as soon as the last of them
 * releases it — never on a wall clock, except as the bounded fallback for a producer that hangs.
 */
export type WorkspaceSnapshotPruneTombstoneRegistry = {
  /** Live tombstones for this sidecar, with expired producer holders already dropped. */
  tombstones: (file: string) => Map<string, WorkspaceSnapshotPruneTombstone> | undefined
  /** `deferred` marks a batch that tombstones now and rewrites the sidecar at finalize. */
  register: (
    file: string,
    targets: readonly WorkspaceSnapshotPruneTarget[],
    deferred: boolean
  ) => void
  /** Open the window in which this scan may still persist a pre-prune result. */
  beginProducer: (snapshotDirectory: string) => string
  /** Close it — the scan persisted, failed, or ended without persisting. */
  finishProducer: (snapshotDirectory: string, holder: string) => void
  releaseFlush: (file: string, keys: ReadonlySet<string>) => void
  count: (file: string) => number
}

export function createWorkspaceSnapshotPruneTombstoneRegistry(
  resolveFile: (snapshotDirectory: string) => string
): WorkspaceSnapshotPruneTombstoneRegistry {
  const tombstonesByFile = new Map<string, Map<string, WorkspaceSnapshotPruneTombstone>>()
  const activeProducersByFile = new Map<string, Set<string>>()
  let nextProducerId = 0

  const release = (file: string, holder: string, keys?: ReadonlySet<string>): void => {
    const tombstones = tombstonesByFile.get(file)
    for (const [key, entry] of tombstones ?? []) {
      // Guard on membership: releasing one holder must not retire tombstones held by others.
      if ((!keys || keys.has(key)) && entry.holders.delete(holder) && entry.holders.size === 0) {
        tombstones?.delete(key)
      }
    }
  }

  const live = (file: string): Map<string, WorkspaceSnapshotPruneTombstone> | undefined => {
    const tombstones = tombstonesByFile.get(file)
    if (!tombstones) {
      return undefined
    }
    const now = Date.now()
    for (const [key, entry] of tombstones) {
      // Presume a producer past its deadline settled. The flush holder is the batch's to release.
      if (entry.producerDeadline <= now) {
        for (const holder of entry.holders) {
          if (holder !== WORKSPACE_SNAPSHOT_PRUNE_FLUSH_HOLDER) {
            entry.holders.delete(holder)
          }
        }
      }
      if (entry.holders.size === 0) {
        tombstones.delete(key)
      }
    }
    if (tombstones.size === 0) {
      tombstonesByFile.delete(file)
      return undefined
    }
    return tombstones
  }

  return {
    tombstones: live,
    register(file, targets, deferred) {
      const tombstones = live(file) ?? new Map()
      registerWorkspaceSnapshotPrunesForFile(tombstones, targets, [
        ...(deferred ? [WORKSPACE_SNAPSHOT_PRUNE_FLUSH_HOLDER] : []),
        ...(activeProducersByFile.get(file) ?? [])
      ])
      if (tombstones.size > 0) {
        tombstonesByFile.set(file, tombstones)
      }
    },
    beginProducer(snapshotDirectory) {
      const file = resolveFile(snapshotDirectory)
      const holder = `producer:${(nextProducerId += 1)}`
      const active = activeProducersByFile.get(file) ?? new Set<string>()
      active.add(holder)
      activeProducersByFile.set(file, active)
      return holder
    },
    finishProducer(snapshotDirectory, holder) {
      const file = resolveFile(snapshotDirectory)
      const active = activeProducersByFile.get(file)
      if (active?.delete(holder) && active.size === 0) {
        activeProducersByFile.delete(file)
      }
      release(file, holder)
    },
    releaseFlush: (file, keys) => release(file, WORKSPACE_SNAPSHOT_PRUNE_FLUSH_HOLDER, keys),
    count: (file) => live(file)?.size ?? 0
  }
}

export { WORKSPACE_SNAPSHOT_PRUNE_PRODUCER_TIMEOUT_MS }
