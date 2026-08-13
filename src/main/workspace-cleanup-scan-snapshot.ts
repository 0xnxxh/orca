import {
  WORKSPACE_CLEANUP_CLASSIFIER_VERSION,
  type WorkspaceCleanupCandidate,
  type WorkspaceCleanupScanArgs,
  type WorkspaceCleanupScanResult
} from '../shared/workspace-cleanup'
import {
  readSidecarSnapshot,
  sidecarSnapshotFile,
  withSidecarSnapshotQueue,
  writeSidecarSnapshot
} from './sidecar-snapshot-file'
import type { ExecutionHostId } from '../shared/execution-host'

const SNAPSHOT_FILE_NAME = 'orca-workspace-cleanup-scan.json'
const SNAPSHOT_VERSION = 2

type PrunedWorkspace = {
  worktreeId: string
  executionHostId?: ExecutionHostId
  prunedAt: number
}

const prunedWorkspacesByFile = new Map<string, Map<string, PrunedWorkspace>>()

type PersistedWorkspaceCleanupScanSnapshot = {
  version: number
  argsFingerprint: string
  result: WorkspaceCleanupScanResult
}

/** Why a fingerprint: a classifier bump reshuffles tiers/blockers wholesale, so an older snapshot must read as absent, not stale-but-plausible. */
export function workspaceCleanupScanSnapshotFingerprint(): string {
  return `classifier:${WORKSPACE_CLEANUP_CLASSIFIER_VERSION}|includeAllWorkspaces`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPersistableCandidate(value: unknown): value is WorkspaceCleanupCandidate {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.worktreeId === 'string' &&
    typeof value.repoId === 'string' &&
    typeof value.fingerprint === 'string' &&
    (value.connectionId === null || typeof value.connectionId === 'string') &&
    typeof value.executionHostId === 'string' &&
    Array.isArray(value.reasons) &&
    Array.isArray(value.blockers) &&
    isRecord(value.git) &&
    isRecord(value.localContext)
  )
}

/** Shape guard so a corrupt persisted blob degrades to null instead of throwing at startup. */
function parseSnapshot(parsed: unknown): WorkspaceCleanupScanResult | null {
  if (!isRecord(parsed)) {
    return null
  }
  if (parsed.version !== SNAPSHOT_VERSION) {
    return null
  }
  if (parsed.argsFingerprint !== workspaceCleanupScanSnapshotFingerprint()) {
    return null
  }
  const result = parsed.result
  if (!isRecord(result)) {
    return null
  }
  if (
    typeof result.scannedAt !== 'number' ||
    !Array.isArray(result.candidates) ||
    !Array.isArray(result.errors) ||
    !result.candidates.every(isPersistableCandidate)
  ) {
    return null
  }
  return result as unknown as WorkspaceCleanupScanResult
}

export async function readWorkspaceCleanupScanSnapshot(
  snapshotDirectory: string
): Promise<WorkspaceCleanupScanResult | null> {
  try {
    return parseSnapshot(
      await readSidecarSnapshot(sidecarSnapshotFile(snapshotDirectory, SNAPSHOT_FILE_NAME))
    )
  } catch {
    return null
  }
}

async function writeSnapshot(file: string, result: WorkspaceCleanupScanResult): Promise<void> {
  await writeSidecarSnapshot(file, {
    version: SNAPSHOT_VERSION,
    argsFingerprint: workspaceCleanupScanSnapshotFingerprint(),
    result
  } satisfies PersistedWorkspaceCleanupScanSnapshot)
}

function patchCandidates(
  existing: WorkspaceCleanupScanResult,
  fresh: WorkspaceCleanupCandidate[]
): WorkspaceCleanupScanResult {
  const freshById = new Map(fresh.map((candidate) => [candidateSnapshotKey(candidate), candidate]))
  const candidates = existing.candidates.map((candidate) => {
    const key = candidateSnapshotKey(candidate)
    const replacement = freshById.get(key)
    freshById.delete(key)
    return replacement ?? candidate
  })
  candidates.push(...freshById.values())
  // Why keep scannedAt: it marks the last FULL scan; a focused rescan must not advertise fleet-wide freshness.
  return { ...existing, candidates }
}

function candidateSnapshotKey(
  candidate: Pick<WorkspaceCleanupCandidate, 'executionHostId' | 'worktreeId'>
): string {
  return `${candidate.executionHostId ?? 'local'}\0${candidate.worktreeId}`
}

function prunedWorkspaceKey(worktreeId: string, executionHostId?: ExecutionHostId): string {
  return `${executionHostId ?? '*'}\0${worktreeId}`
}

function matchesPrunedWorkspace(
  candidate: WorkspaceCleanupCandidate,
  pruned: PrunedWorkspace
): boolean {
  return (
    candidate.worktreeId === pruned.worktreeId &&
    (!pruned.executionHostId || candidate.executionHostId === pruned.executionHostId)
  )
}

function excludeRowsPrunedDuringScan(
  file: string,
  result: WorkspaceCleanupScanResult
): WorkspaceCleanupScanResult {
  const pruned = [...(prunedWorkspacesByFile.get(file)?.values() ?? [])]
  if (pruned.length === 0) {
    return result
  }
  const candidates = result.candidates.filter(
    (candidate) =>
      !pruned.some(
        (entry) => entry.prunedAt >= result.scannedAt && matchesPrunedWorkspace(candidate, entry)
      )
  )
  return candidates.length === result.candidates.length ? result : { ...result, candidates }
}

function clearSupersededPrunes(
  file: string,
  result: WorkspaceCleanupScanResult,
  broad: boolean
): void {
  const pruned = prunedWorkspacesByFile.get(file)
  if (!pruned) {
    return
  }
  for (const [key, entry] of pruned) {
    if (
      entry.prunedAt < result.scannedAt &&
      (broad || result.candidates.some((candidate) => matchesPrunedWorkspace(candidate, entry)))
    ) {
      pruned.delete(key)
    }
  }
  if (pruned.size === 0) {
    prunedWorkspacesByFile.delete(file)
  }
}

/**
 * Persist a completed scan: a broad (includeAllWorkspaces) scan replaces the snapshot, anything
 * narrower patches matching rows into it. Never throws — the snapshot is a refetchable cache.
 */
export async function persistWorkspaceCleanupScanResult(
  snapshotDirectory: string,
  args: WorkspaceCleanupScanArgs,
  result: WorkspaceCleanupScanResult
): Promise<void> {
  const file = sidecarSnapshotFile(snapshotDirectory, SNAPSHOT_FILE_NAME)
  try {
    await withSidecarSnapshotQueue(file, async () => {
      const filteredResult = excludeRowsPrunedDuringScan(file, result)
      const broad = !args.worktreeId && args.includeAllWorkspaces === true
      if (broad) {
        const existing = await readWorkspaceCleanupScanSnapshot(snapshotDirectory)
        if (existing && existing.scannedAt > filteredResult.scannedAt) {
          return
        }
        await writeSnapshot(file, filteredResult)
        clearSupersededPrunes(file, result, true)
        return
      }
      if (filteredResult.candidates.length === 0) {
        return
      }
      const existing = await readWorkspaceCleanupScanSnapshot(snapshotDirectory)
      // Why: a focused/legacy scan is a subset; without a broad baseline it is not a fleet snapshot.
      if (!existing) {
        return
      }
      await writeSnapshot(file, patchCandidates(existing, filteredResult.candidates))
      clearSupersededPrunes(file, result, false)
    })
  } catch (error) {
    console.warn('[workspace-cleanup] failed to persist scan snapshot:', error)
  }
}

/** Drop a removed workspace so it never resurrects from cache. Never throws. */
export async function pruneWorkspaceCleanupScanSnapshot(
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
      const existing = await readWorkspaceCleanupScanSnapshot(snapshotDirectory)
      if (!existing) {
        return
      }
      const candidates = existing.candidates.filter(
        (candidate) =>
          candidate.worktreeId !== worktreeId ||
          (executionHostId !== undefined && candidate.executionHostId !== executionHostId)
      )
      if (candidates.length === existing.candidates.length) {
        return
      }
      await writeSnapshot(file, { ...existing, candidates })
    })
  } catch (error) {
    console.warn('[workspace-cleanup] failed to prune scan snapshot:', error)
  }
}
