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
  candidates
}: {
  enabled: boolean
  candidates: readonly WorkspaceCleanupCandidate[]
}): WorkspaceCleanupGitEvidenceState {
  const scanWorkspaceCleanup = useAppStore((s) => s.scanWorkspaceCleanup)
  const mountedRef = useMountedRef()
  const [state, setState] = useState<WorkspaceCleanupGitEvidenceState>(EMPTY_EVIDENCE)
  const evidenceRef = useRef(new Map<string, WorkspaceCleanupCandidate>())
  const attemptedRef = useRef(new Set<string>())
  const queueRef = useRef<string[]>([])
  const inFlightRef = useRef(new Set<string>())
  const totalRef = useRef(0)
  // Why: results that land after the user cleared the git filter belong to a
  // stale pass and must not resurrect its pending banner.
  const generationRef = useRef(0)

  const publish = useCallback(() => {
    if (!mountedRef.current) {
      return
    }
    setState({
      evidenceByWorktreeId: new Map(evidenceRef.current),
      pendingWorktreeIds: new Set(inFlightRef.current),
      checkedCount: totalRef.current - queueRef.current.length - inFlightRef.current.size,
      totalCount: totalRef.current
    })
  }, [mountedRef])

  const pump = useCallback(() => {
    const generation = generationRef.current
    while (
      inFlightRef.current.size < WORKSPACE_CLEANUP_GIT_EVIDENCE_CONCURRENCY &&
      queueRef.current.length > 0
    ) {
      const worktreeId = queueRef.current.shift()
      if (worktreeId === undefined) {
        break
      }
      inFlightRef.current.add(worktreeId)
      attemptedRef.current.add(worktreeId)
      void scanWorkspaceCleanup({ worktreeId })
        .then((result) => {
          const refreshed = result.candidates.find(
            (candidate) => candidate.worktreeId === worktreeId
          )
          if (refreshed && generation === generationRef.current) {
            evidenceRef.current.set(worktreeId, refreshed)
          }
        })
        .catch(() => {
          // Why: a failed focused scan leaves the row honestly "Not checked";
          // attemptedRef keeps it from retrying in a loop.
        })
        .finally(() => {
          inFlightRef.current.delete(worktreeId)
          if (generation !== generationRef.current) {
            return
          }
          publish()
          pump()
        })
    }
    publish()
  }, [publish, scanWorkspaceCleanup])

  useEffect(() => {
    if (!enabled) {
      generationRef.current += 1
      queueRef.current = []
      inFlightRef.current.clear()
      totalRef.current = 0
      publish()
      return
    }
    const targets = selectWorkspaceCleanupGitEvidenceTargets(candidates, {
      resolvedWorktreeIds: attemptedRef.current
    }).filter((id) => !queueRef.current.includes(id))
    if (targets.length === 0) {
      return
    }
    queueRef.current.push(...targets)
    totalRef.current += targets.length
    pump()
  }, [candidates, enabled, pump, publish])

  return state
}
