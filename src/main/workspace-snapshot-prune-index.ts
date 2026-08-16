import type { ExecutionHostId } from '../shared/execution-host'

export type WorkspaceSnapshotPruneTarget = {
  worktreeId: string
  executionHostId?: ExecutionHostId
}

/**
 * `holders` is the retirement gate (STA-4451): the writers that could still resurrect this row.
 * `producerDeadline` bounds only the producer holders — see the tombstone registry.
 */
export type WorkspaceSnapshotPruneTombstone = WorkspaceSnapshotPruneTarget & {
  prunedAt: number
  producerDeadline: number
  holders: Set<string>
}

/**
 * Bounded fallback for a producer that never reports back — a scan wedged on an unreachable SSH
 * host, or a renderer torn down mid-scan. Deliberately longer than the removal batch's idle
 * timeout so it can never preempt a pending flush, which it does not police.
 */
export const WORKSPACE_SNAPSHOT_PRUNE_PRODUCER_TIMEOUT_MS = 10 * 60 * 1000

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
    if (entry.prunedAt >= scannedAt) {
      keys.add(key)
    }
  }
  return keys
}

export function registerWorkspaceSnapshotPrunesForFile(
  tombstones: Map<string, WorkspaceSnapshotPruneTombstone>,
  targets: readonly WorkspaceSnapshotPruneTarget[],
  holders: Iterable<string>
): void {
  const prunedAt = Date.now()
  for (const { worktreeId, executionHostId } of targets) {
    const key = workspaceSnapshotPruneKey(worktreeId, executionHostId)
    // Union, never replace: a re-registered target may still be held by an earlier batch.
    const merged = new Set([...(tombstones.get(key)?.holders ?? []), ...holders])
    tombstones.set(key, {
      worktreeId,
      ...(executionHostId ? { executionHostId } : {}),
      prunedAt,
      producerDeadline: prunedAt + WORKSPACE_SNAPSHOT_PRUNE_PRODUCER_TIMEOUT_MS,
      holders: merged
    })
  }
}
