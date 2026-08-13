import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import type { WorkspaceCleanupCandidate } from '../../../../shared/workspace-cleanup'
import {
  selectWorkspaceCleanupGitEvidenceTargets,
  WORKSPACE_CLEANUP_GIT_EVIDENCE_CONCURRENCY
} from './workspace-cleanup-git-evidence'

export type WorkspaceCleanupGitEvidenceState = {
  /** Focused re-scan results, keyed by worktree id. */
  evidenceByWorktreeId: ReadonlyMap<string, WorkspaceCleanupCandidate>
  pendingWorktreeIds: ReadonlySet<string>
  checkedCount: number
  totalCount: number
}

const EMPTY_EVIDENCE: WorkspaceCleanupGitEvidenceState = {
  evidenceByWorktreeId: new Map(),
  pendingWorktreeIds: new Set(),
  checkedCount: 0,
  totalCount: 0
}

/**
 * Fills in git evidence the broad scan deferred, one focused re-scan per row.
 * Only runs while a git-dependent filter or sort is active — the initial list
 * render never waits on it, so an unfiltered browse stays instant.
 */
export function useWorkspaceCleanupGitEvidence({
  enabled,
  candidates,
  scannedAt
}: {
  enabled: boolean
  candidates: readonly WorkspaceCleanupCandidate[]
  scannedAt: number | null
}): WorkspaceCleanupGitEvidenceState {
  const scanWorkspaceCleanup = useAppStore((s) => s.scanWorkspaceCleanup)
  const mountedRef = useMountedRef()
  const [state, setState] = useState<WorkspaceCleanupGitEvidenceState>(EMPTY_EVIDENCE)
  const evidenceRef = useRef(new Map<string, WorkspaceCleanupCandidate>())
  const attemptedRef = useRef(new Set<string>())
  const queueRef = useRef<string[]>([])
  const queuedRef = useRef(new Set<string>())
  const inFlightRef = useRef(new Set<string>())
  // Why: restarted filters must share one physical RPC/subprocess cap.
  const activeRequestWorktreeIdsRef = useRef(new Set<string>())
  const totalRef = useRef(0)
  const enabledRef = useRef(enabled)
  const scannedAtRef = useRef(scannedAt)
  // Why: results that land after the user cleared the git filter belong to a
  // stale pass and must not resurrect its pending banner.
  const generationRef = useRef(0)

  const publish = useCallback(() => {
    if (!mountedRef.current) {
      return
    }
    setState({
      evidenceByWorktreeId: new Map(evidenceRef.current),
      pendingWorktreeIds: new Set([...queuedRef.current, ...inFlightRef.current]),
      checkedCount: totalRef.current - queuedRef.current.size - inFlightRef.current.size,
      totalCount: totalRef.current
    })
  }, [mountedRef])

  const pump = useCallback(() => {
    const generation = generationRef.current
    while (
      activeRequestWorktreeIdsRef.current.size < WORKSPACE_CLEANUP_GIT_EVIDENCE_CONCURRENCY &&
      queueRef.current.length > 0
    ) {
      const queueIndex = queueRef.current.findIndex(
        (worktreeId) => !activeRequestWorktreeIdsRef.current.has(worktreeId)
      )
      if (queueIndex === -1) {
        break
      }
      const [worktreeId] = queueRef.current.splice(queueIndex, 1)
      queuedRef.current.delete(worktreeId)
      inFlightRef.current.add(worktreeId)
      activeRequestWorktreeIdsRef.current.add(worktreeId)
      attemptedRef.current.add(worktreeId)
      void scanWorkspaceCleanup({ worktreeId })
        .then((result) => {
          let refreshed: WorkspaceCleanupCandidate | undefined
          for (const candidate of result.candidates) {
            if (candidate.worktreeId === worktreeId) {
              refreshed = candidate
              break
            }
          }
          if (refreshed && generation === generationRef.current) {
            evidenceRef.current.set(worktreeId, refreshed)
          }
        })
        .catch(() => {
          // Why: a failed focused scan leaves the row honestly "Not checked";
          // attemptedRef keeps it from retrying in a loop.
        })
        .finally(() => {
          activeRequestWorktreeIdsRef.current.delete(worktreeId)
          if (generation === generationRef.current) {
            inFlightRef.current.delete(worktreeId)
          }
          pump()
        })
    }
    publish()
  }, [publish, scanWorkspaceCleanup])

  useEffect(() => {
    const wasEnabled = enabledRef.current
    const snapshotChanged = scannedAtRef.current !== scannedAt
    enabledRef.current = enabled
    scannedAtRef.current = scannedAt

    if ((wasEnabled && !enabled) || (enabled && snapshotChanged)) {
      generationRef.current += 1
      queueRef.current = []
      queuedRef.current.clear()
      inFlightRef.current.clear()
      attemptedRef.current.clear()
      evidenceRef.current.clear()
      totalRef.current = 0
      publish()
    }
    if (!enabled) {
      return
    }
    const targets = selectWorkspaceCleanupGitEvidenceTargets(candidates, {
      resolvedWorktreeIds: attemptedRef.current
    }).filter((id) => !queuedRef.current.has(id) && !inFlightRef.current.has(id))
    if (targets.length === 0) {
      return
    }
    queueRef.current.push(...targets)
    for (const target of targets) {
      queuedRef.current.add(target)
    }
    totalRef.current += targets.length
    pump()
  }, [candidates, enabled, pump, publish, scannedAt])

  return state
}
