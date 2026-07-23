import type { GitHubPRRefreshReason } from '../../../../shared/types'

type ChecksPanelPRRefreshRequestInput = {
  cachedHasPR: boolean | null
  cachedFetchedAt: number | null
  panelVisibleSince: number | null
  // A known-but-unrendered review needs one foreground lookup to resolve its transient state.
  hasUnrenderedReviewEvidence?: boolean
  hasRequestedForegroundRefresh?: boolean
}

type ChecksPanelPRRefreshRequest = {
  reason: GitHubPRRefreshReason
  priority: number
}

export function resolveChecksPanelPRRefreshRequest(
  input: ChecksPanelPRRefreshRequestInput
): ChecksPanelPRRefreshRequest {
  const cachedMissPredatesVisiblePanel =
    input.cachedHasPR === false &&
    input.cachedFetchedAt !== null &&
    input.panelVisibleSince !== null &&
    input.cachedFetchedAt < input.panelVisibleSince
  const unresolvedEvidenceNeedsForeground =
    input.hasUnrenderedReviewEvidence && input.cachedHasPR !== true

  if (
    !input.hasRequestedForegroundRefresh &&
    (cachedMissPredatesVisiblePanel || unresolvedEvidenceNeedsForeground)
  ) {
    // A stale miss or new positive evidence needs one foreground lookup to recover.
    return { reason: 'active', priority: 80 }
  }

  return { reason: 'swr', priority: 30 }
}
