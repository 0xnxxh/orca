import type { WorkspaceCleanupCandidate } from '../../../../shared/workspace-cleanup'
import {
  getWorkspaceCleanupCandidateIdentity,
  getWorkspaceCleanupIdentityWorktreeId
} from '../../../../shared/workspace-cleanup-host-identity'
import type { WorkspaceCleanupDeletionPhase } from './workspace-cleanup-candidate-row'

export function getWorkspaceCleanupDeletionPhaseByIdentity(
  candidates: readonly WorkspaceCleanupCandidate[],
  cleanupPhases: Readonly<Record<string, WorkspaceCleanupDeletionPhase>>,
  genericPhasesByWorktreeId: Readonly<Record<string, WorkspaceCleanupDeletionPhase>>
): Record<string, WorkspaceCleanupDeletionPhase> {
  const cleanupWorktreeIds = new Set(
    Object.keys(cleanupPhases).map(getWorkspaceCleanupIdentityWorktreeId)
  )
  const phases = { ...cleanupPhases }
  for (const candidate of candidates) {
    if (cleanupWorktreeIds.has(candidate.worktreeId)) {
      continue
    }
    const phase = genericPhasesByWorktreeId[candidate.worktreeId]
    if (phase) {
      phases[getWorkspaceCleanupCandidateIdentity(candidate)] = phase
    }
  }
  return phases
}
