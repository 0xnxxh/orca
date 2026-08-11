import type {
  WorkspaceSpaceAnalysis,
  WorkspaceSpaceWorktree
} from '../shared/workspace-space-types'
import {
  readSidecarSnapshot,
  sidecarSnapshotFile,
  withSidecarSnapshotQueue,
  writeSidecarSnapshot
} from './sidecar-snapshot-file'
import type { ExecutionHostId } from '../shared/execution-host'

const SNAPSHOT_FILE_NAME = 'orca-workspace-space-analysis.json'
const SNAPSHOT_VERSION = 2

type PrunedWorkspace = {
  worktreeId: string
  executionHostId?: ExecutionHostId
  prunedAt: number
}

const prunedWorkspacesByFile = new Map<string, Map<string, PrunedWorkspace>>()

type PersistedWorkspaceSpaceAnalysisSnapshot = {
  version: number
  analysis: WorkspaceSpaceAnalysis
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPersistableWorktreeRow(value: unknown): value is WorkspaceSpaceWorktree {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.worktreeId === 'string' &&
    typeof value.repoId === 'string' &&
    typeof value.executionHostId === 'string' &&
    typeof value.status === 'string' &&
    typeof value.sizeBytes === 'number' &&
    typeof value.reclaimableBytes === 'number' &&
    Array.isArray(value.topLevelItems)
  )
}

/** Shape guard so a corrupt persisted blob degrades to null instead of throwing at startup. */
function parseSnapshot(parsed: unknown): WorkspaceSpaceAnalysis | null {
  if (!isRecord(parsed) || parsed.version !== SNAPSHOT_VERSION) {
    return null
  }
  const analysis = parsed.analysis
  if (!isRecord(analysis)) {
    return null
  }
  if (
    typeof analysis.scannedAt !== 'number' ||
    typeof analysis.totalSizeBytes !== 'number' ||
    !Array.isArray(analysis.repos) ||
    !Array.isArray(analysis.worktrees) ||
    !analysis.worktrees.every(isPersistableWorktreeRow)
  ) {
    return null
  }
  return analysis as unknown as WorkspaceSpaceAnalysis
}

// Why strip topLevelItems: 500+ worktrees x 48 items is a multi-MB blob, and the cached view only
// needs per-worktree totals. Fold the items into the omitted counters so each row stays consistent.
function stripTopLevelItems(analysis: WorkspaceSpaceAnalysis): WorkspaceSpaceAnalysis {
  return {
    ...analysis,
    worktrees: analysis.worktrees.map((row) => ({
      ...row,
      topLevelItems: [],
      omittedTopLevelItemCount: row.omittedTopLevelItemCount + row.topLevelItems.length,
      omittedTopLevelSizeBytes:
        row.omittedTopLevelSizeBytes +
        row.topLevelItems.reduce((sum, item) => sum + item.sizeBytes, 0)
    }))
  }
}

export async function readWorkspaceSpaceAnalysisSnapshot(
  snapshotDirectory: string
): Promise<WorkspaceSpaceAnalysis | null> {
  try {
    return parseSnapshot(
      await readSidecarSnapshot(sidecarSnapshotFile(snapshotDirectory, SNAPSHOT_FILE_NAME))
    )
  } catch {
    return null
  }
}

async function writeSnapshot(file: string, analysis: WorkspaceSpaceAnalysis): Promise<void> {
  await writeSidecarSnapshot(file, {
    version: SNAPSHOT_VERSION,
    analysis
  } satisfies PersistedWorkspaceSpaceAnalysisSnapshot)
}

/** Persist a completed analysis. Never throws — the snapshot is a refetchable cache. */
export async function persistWorkspaceSpaceAnalysisSnapshot(
  snapshotDirectory: string,
  analysis: WorkspaceSpaceAnalysis
): Promise<void> {
  const file = sidecarSnapshotFile(snapshotDirectory, SNAPSHOT_FILE_NAME)
  try {
    await withSidecarSnapshotQueue(file, async () => {
      await writeSnapshot(file, stripTopLevelItems(excludeRowsPrunedDuringScan(file, analysis)))
      clearSupersededPrunes(file, analysis)
    })
  } catch (error) {
    console.warn('[workspace-space] failed to persist analysis snapshot:', error)
  }
}

function withoutWorktreeRow(
  analysis: WorkspaceSpaceAnalysis,
  removed: WorkspaceSpaceWorktree
): WorkspaceSpaceAnalysis {
  const scannedDelta = removed.status === 'ok' ? 1 : 0
  const unavailableDelta = removed.status === 'ok' ? 0 : 1
  return {
    ...analysis,
    worktrees: analysis.worktrees.filter((row) => !isSameWorkspace(row, removed)),
    worktreeCount: Math.max(0, analysis.worktreeCount - 1),
    scannedWorktreeCount: Math.max(0, analysis.scannedWorktreeCount - scannedDelta),
    unavailableWorktreeCount: Math.max(0, analysis.unavailableWorktreeCount - unavailableDelta),
    totalSizeBytes: Math.max(0, analysis.totalSizeBytes - removed.sizeBytes),
    reclaimableBytes: Math.max(0, analysis.reclaimableBytes - removed.reclaimableBytes),
    repos: analysis.repos.map((repo) =>
      repo.repoId === removed.repoId && repo.executionHostId === removed.executionHostId
        ? {
            ...repo,
            worktreeCount: Math.max(0, repo.worktreeCount - 1),
            scannedWorktreeCount: Math.max(0, repo.scannedWorktreeCount - scannedDelta),
            unavailableWorktreeCount: Math.max(0, repo.unavailableWorktreeCount - unavailableDelta),
            totalSizeBytes: Math.max(0, repo.totalSizeBytes - removed.sizeBytes),
            reclaimableBytes: Math.max(0, repo.reclaimableBytes - removed.reclaimableBytes)
          }
        : repo
    )
  }
}

function isSameWorkspace(
  left: Pick<WorkspaceSpaceWorktree, 'executionHostId' | 'worktreeId'>,
  right: Pick<WorkspaceSpaceWorktree, 'executionHostId' | 'worktreeId'>
): boolean {
  return left.worktreeId === right.worktreeId && left.executionHostId === right.executionHostId
}

function prunedWorkspaceKey(worktreeId: string, executionHostId?: ExecutionHostId): string {
  return `${executionHostId ?? '*'}\0${worktreeId}`
}

function matchesPrunedWorkspace(row: WorkspaceSpaceWorktree, pruned: PrunedWorkspace): boolean {
  return (
    row.worktreeId === pruned.worktreeId &&
    (!pruned.executionHostId || row.executionHostId === pruned.executionHostId)
  )
}

function excludeRowsPrunedDuringScan(
  file: string,
  analysis: WorkspaceSpaceAnalysis
): WorkspaceSpaceAnalysis {
  const pruned = [...(prunedWorkspacesByFile.get(file)?.values() ?? [])]
  return analysis.worktrees.reduce(
    (current, row) =>
      pruned.some(
        (entry) => entry.prunedAt >= analysis.scannedAt && matchesPrunedWorkspace(row, entry)
      )
        ? withoutWorktreeRow(current, row)
        : current,
    analysis
  )
}

function clearSupersededPrunes(file: string, analysis: WorkspaceSpaceAnalysis): void {
  const pruned = prunedWorkspacesByFile.get(file)
  if (!pruned) {
    return
  }
  for (const [key, entry] of pruned) {
    if (entry.prunedAt < analysis.scannedAt) {
      pruned.delete(key)
    }
  }
  if (pruned.size === 0) {
    prunedWorkspacesByFile.delete(file)
  }
}

/** Drop a removed workspace's row and rebalance the totals it contributed. Never throws. */
export async function pruneWorkspaceSpaceAnalysisSnapshot(
  snapshotDirectory: string,
  worktreeId: string,
  executionHostId?: ExecutionHostId
): Promise<void> {
  const file = sidecarSnapshotFile(snapshotDirectory, SNAPSHOT_FILE_NAME)
  const pruned = prunedWorkspacesByFile.get(file) ?? new Map<string, PrunedWorkspace>()
  pruned.set(prunedWorkspaceKey(worktreeId, executionHostId), {
    worktreeId,
    ...(executionHostId ? { executionHostId } : {}),
    prunedAt: Date.now()
  })
  prunedWorkspacesByFile.set(file, pruned)
  try {
    await withSidecarSnapshotQueue(file, async () => {
      const existing = await readWorkspaceSpaceAnalysisSnapshot(snapshotDirectory)
      const removed = existing?.worktrees.find(
        (row) =>
          row.worktreeId === worktreeId &&
          (executionHostId === undefined || row.executionHostId === executionHostId)
      )
      if (!existing || !removed) {
        return
      }
      await writeSnapshot(file, withoutWorktreeRow(existing, removed))
    })
  } catch (error) {
    console.warn('[workspace-space] failed to prune analysis snapshot:', error)
  }
}
