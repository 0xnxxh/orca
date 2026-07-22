import type { GitHubPRRefreshReason } from '../../../../shared/types'

type ChecksPanelPRRefreshRequestInput = {
  cachedHasPR: boolean | null
  cachedFetchedAt: number | null
  panelVisibleSince: number | null
  // Why: a review is known to exist (positive evidence / existing_review) but no
  // renderable PR is cached yet. A lazy SWR fetch leaves the panel on a transient
  // "Checking status" state; a foreground lookup resolves it to the review.
  hasUnrenderedReviewEvidence?: boolean
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

  if (cachedMissPredatesVisiblePanel || input.hasUnrenderedReviewEvidence) {
    // Why: external agents can create/merge a PR after Orca cached "none", and
    // a known-but-unrendered review must resolve to the panel rather than stall
    // on a transient card — both need one foreground lookup to recover.
    return { reason: 'active', priority: 80 }
  }

  return { reason: 'swr', priority: 30 }
}
