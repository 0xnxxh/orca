import type {
  WorkspaceSpaceAnalysis,
  WorkspaceSpaceWorktree
} from '../shared/workspace-space-types'
import {
  readSidecarSnapshot,
  withSidecarSnapshotQueue,
  writeSidecarSnapshot
} from './sidecar-snapshot-file'

const SNAPSHOT_FILE_NAME = 'orca-workspace-space-analysis.json'
const SNAPSHOT_VERSION = 1

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

export async function readWorkspaceSpaceAnalysisSnapshot(): Promise<WorkspaceSpaceAnalysis | null> {
  try {
    return parseSnapshot(await readSidecarSnapshot(SNAPSHOT_FILE_NAME))
  } catch {
    return null
  }
}

async function writeSnapshot(analysis: WorkspaceSpaceAnalysis): Promise<void> {
  await writeSidecarSnapshot(SNAPSHOT_FILE_NAME, {
    version: SNAPSHOT_VERSION,
    analysis
  } satisfies PersistedWorkspaceSpaceAnalysisSnapshot)
}

/** Persist a completed analysis. Never throws — the snapshot is a refetchable cache. */
export async function persistWorkspaceSpaceAnalysisSnapshot(
  analysis: WorkspaceSpaceAnalysis
): Promise<void> {
  try {
    await withSidecarSnapshotQueue(SNAPSHOT_FILE_NAME, () =>
      writeSnapshot(stripTopLevelItems(analysis))
    )
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
    worktrees: analysis.worktrees.filter((row) => row.worktreeId !== removed.worktreeId),
    worktreeCount: Math.max(0, analysis.worktreeCount - 1),
    scannedWorktreeCount: Math.max(0, analysis.scannedWorktreeCount - scannedDelta),
    unavailableWorktreeCount: Math.max(0, analysis.unavailableWorktreeCount - unavailableDelta),
    totalSizeBytes: Math.max(0, analysis.totalSizeBytes - removed.sizeBytes),
    reclaimableBytes: Math.max(0, analysis.reclaimableBytes - removed.reclaimableBytes),
    repos: analysis.repos.map((repo) =>
      repo.repoId === removed.repoId
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

/** Drop a removed workspace's row and rebalance the totals it contributed. Never throws. */
export async function pruneWorkspaceSpaceAnalysisSnapshot(worktreeId: string): Promise<void> {
  try {
    await withSidecarSnapshotQueue(SNAPSHOT_FILE_NAME, async () => {
      const existing = await readWorkspaceSpaceAnalysisSnapshot()
      const removed = existing?.worktrees.find((row) => row.worktreeId === worktreeId)
      if (!existing || !removed) {
        return
      }
      await writeSnapshot(withoutWorktreeRow(existing, removed))
    })
  } catch (error) {
    console.warn('[workspace-space] failed to prune analysis snapshot:', error)
  }
}
