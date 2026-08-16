import type { ExecutionHostId } from '../shared/execution-host'

export type WorkspaceSnapshotPruneTarget = {
  worktreeId: string
  executionHostId?: ExecutionHostId
}

export type WorkspaceSnapshotPruneTombstone = WorkspaceSnapshotPruneTarget & {
  prunedAt: number
  expiresAt: number
  pendingProducerIds: Set<number>
}

export const WORKSPACE_SNAPSHOT_PRUNE_TOMBSTONE_TTL_MS = 10 * 60 * 1000

export function workspaceSnapshotPruneKey(
  worktreeId: string,
  executionHostId?: ExecutionHostId
): string {
  return `${executionHostId ?? '*'}\0${worktreeId}`
}

export function workspaceSnapshotPruneTargetKeys(
  targets: readonly WorkspaceSnapshotPruneTarget[]
): Set<string> {
  return new Set(
    targets.map(({ worktreeId, executionHostId }) =>
      workspaceSnapshotPruneKey(worktreeId, executionHostId)
    )
  )
}

export function activeWorkspaceSnapshotPruneKeys(
  tombstones: ReadonlyMap<string, WorkspaceSnapshotPruneTombstone> | undefined,
  scannedAt: number
): Set<string> {
  const keys = new Set<string>()
  for (const [key, entry] of tombstones ?? []) {
    if (entry.pendingProducerIds.size > 0 || entry.prunedAt >= scannedAt) {
      keys.add(key)
    }
  }
  return keys
}

export function registerWorkspaceSnapshotPrunesForFile(
  tombstonesByFile: Map<string, Map<string, WorkspaceSnapshotPruneTombstone>>,
  file: string,
  targets: readonly WorkspaceSnapshotPruneTarget[],
  activeProducerIds: ReadonlySet<number> = new Set()
): void {
  const tombstones = tombstonesByFile.get(file) ?? new Map()
  const prunedAt = Date.now()
  for (const { worktreeId, executionHostId } of targets) {
    tombstones.set(workspaceSnapshotPruneKey(worktreeId, executionHostId), {
      worktreeId,
      ...(executionHostId ? { executionHostId } : {}),
      prunedAt,
      expiresAt: prunedAt + WORKSPACE_SNAPSHOT_PRUNE_TOMBSTONE_TTL_MS,
      pendingProducerIds: new Set(activeProducerIds)
    })
  }
  tombstonesByFile.set(file, tombstones)
}

export function expireWorkspaceSnapshotPrunes(
  tombstonesByFile: Map<string, Map<string, WorkspaceSnapshotPruneTombstone>>,
  file: string,
  now = Date.now()
): void {
  const tombstones = tombstonesByFile.get(file)
  if (!tombstones) {
    return
  }
  for (const [key, entry] of tombstones) {
    if (entry.expiresAt <= now) {
      tombstones.delete(key)
    }
  }
  if (tombstones.size === 0) {
    tombstonesByFile.delete(file)
  }
}

export function settleWorkspaceSnapshotPruneProducer(
  tombstonesByFile: Map<string, Map<string, WorkspaceSnapshotPruneTombstone>>,
  file: string,
  producerId: number
): void {
  const tombstones = tombstonesByFile.get(file)
  if (!tombstones) {
    return
  }
  for (const [key, entry] of tombstones) {
    entry.pendingProducerIds.delete(producerId)
    if (entry.pendingProducerIds.size === 0) {
      tombstones.delete(key)
    }
  }
  if (tombstones.size === 0) {
    tombstonesByFile.delete(file)
  }
}

export function createWorkspaceSnapshotPruneProducerFence(
  tombstonesByFile: Map<string, Map<string, WorkspaceSnapshotPruneTombstone>>,
  resolveFile: (snapshotDirectory: string) => string
): {
  begin: (snapshotDirectory: string) => number
  finish: (snapshotDirectory: string, producerId: number) => void
  activeIds: (file: string) => ReadonlySet<number> | undefined
} {
  const activeProducerIdsByFile = new Map<string, Set<number>>()
  let nextProducerId = 1
  return {
    begin(snapshotDirectory) {
      const file = resolveFile(snapshotDirectory)
      const producerId = nextProducerId++
      const producers = activeProducerIdsByFile.get(file) ?? new Set()
      producers.add(producerId)
      activeProducerIdsByFile.set(file, producers)
      return producerId
    },
    finish(snapshotDirectory, producerId) {
      const file = resolveFile(snapshotDirectory)
      const producers = activeProducerIdsByFile.get(file)
      producers?.delete(producerId)
      if (producers?.size === 0) {
        activeProducerIdsByFile.delete(file)
      }
      settleWorkspaceSnapshotPruneProducer(tombstonesByFile, file, producerId)
    },
    activeIds: (file) => activeProducerIdsByFile.get(file)
  }
}
