import {
  WORKSPACE_CLEANUP_CLASSIFIER_VERSION,
  type WorkspaceCleanupCandidate,
  type WorkspaceCleanupScanArgs,
  type WorkspaceCleanupScanResult
} from '../shared/workspace-cleanup'
import {
  readSidecarSnapshot,
  withSidecarSnapshotQueue,
  writeSidecarSnapshot
} from './sidecar-snapshot-file'

const SNAPSHOT_FILE_NAME = 'orca-workspace-cleanup-scan.json'
const SNAPSHOT_VERSION = 1

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

export async function readWorkspaceCleanupScanSnapshot(): Promise<WorkspaceCleanupScanResult | null> {
  try {
    return parseSnapshot(await readSidecarSnapshot(SNAPSHOT_FILE_NAME))
  } catch {
    return null
  }
}

async function writeSnapshot(result: WorkspaceCleanupScanResult): Promise<void> {
  await writeSidecarSnapshot(SNAPSHOT_FILE_NAME, {
    version: SNAPSHOT_VERSION,
    argsFingerprint: workspaceCleanupScanSnapshotFingerprint(),
    result
  } satisfies PersistedWorkspaceCleanupScanSnapshot)
}

function patchCandidates(
  existing: WorkspaceCleanupScanResult,
  fresh: WorkspaceCleanupCandidate[]
): WorkspaceCleanupScanResult {
  const freshById = new Map(fresh.map((candidate) => [candidate.worktreeId, candidate]))
  const candidates = existing.candidates.map((candidate) => {
    const replacement = freshById.get(candidate.worktreeId)
    freshById.delete(candidate.worktreeId)
    return replacement ?? candidate
  })
  candidates.push(...freshById.values())
  // Why keep scannedAt: it marks the last FULL scan; a focused rescan must not advertise fleet-wide freshness.
  return { ...existing, candidates }
}

/**
 * Persist a completed scan: a broad (includeAllWorkspaces) scan replaces the snapshot, anything
 * narrower patches matching rows into it. Never throws — the snapshot is a refetchable cache.
 */
export async function persistWorkspaceCleanupScanResult(
  args: WorkspaceCleanupScanArgs,
  result: WorkspaceCleanupScanResult
): Promise<void> {
  try {
    await withSidecarSnapshotQueue(SNAPSHOT_FILE_NAME, async () => {
      if (!args.worktreeId && args.includeAllWorkspaces === true) {
        await writeSnapshot(result)
        return
      }
      if (result.candidates.length === 0) {
        return
      }
      const existing = await readWorkspaceCleanupScanSnapshot()
      // Why: a focused/legacy scan is a subset; without a broad baseline it is not a fleet snapshot.
      if (!existing) {
        return
      }
      await writeSnapshot(patchCandidates(existing, result.candidates))
    })
  } catch (error) {
    console.warn('[workspace-cleanup] failed to persist scan snapshot:', error)
  }
}

/** Drop a removed workspace so it never resurrects from cache. Never throws. */
export async function pruneWorkspaceCleanupScanSnapshot(worktreeId: string): Promise<void> {
  try {
    await withSidecarSnapshotQueue(SNAPSHOT_FILE_NAME, async () => {
      const existing = await readWorkspaceCleanupScanSnapshot()
      if (!existing) {
        return
      }
      const candidates = existing.candidates.filter(
        (candidate) => candidate.worktreeId !== worktreeId
      )
      if (candidates.length === existing.candidates.length) {
        return
      }
      await writeSnapshot({ ...existing, candidates })
    })
  } catch (error) {
    console.warn('[workspace-cleanup] failed to prune scan snapshot:', error)
  }
}
