import type { HostedReviewCreationEligibility } from '../../../src/shared/hosted-review'

// Why: every source-control open remounts the eligibility hook, so without a
// cross-mount memory each open cold-fetches and the Create PR row's footprint
// is unknown until the host answers — the row then pops in or collapses under
// the user's finger (#8411). Remembering the last resolved answer per
// worktree+branch lets the next open render the correct footprint immediately.
const MAX_REMEMBERED_ELIGIBILITIES = 64

const lastResolvedByIdentity = new Map<string, HostedReviewCreationEligibility>()

export function rememberHostedReviewEligibility(
  identity: string,
  eligibility: HostedReviewCreationEligibility
): void {
  // Delete-then-set keeps insertion order as recency so eviction drops the LRU entry.
  lastResolvedByIdentity.delete(identity)
  lastResolvedByIdentity.set(identity, eligibility)
  if (lastResolvedByIdentity.size > MAX_REMEMBERED_ELIGIBILITIES) {
    const oldest = lastResolvedByIdentity.keys().next().value
    if (oldest !== undefined) {
      lastResolvedByIdentity.delete(oldest)
    }
  }
}

export function recallHostedReviewEligibility(
  identity: string
): HostedReviewCreationEligibility | null {
  return lastResolvedByIdentity.get(identity) ?? null
}

export function forgetAllHostedReviewEligibility(): void {
  lastResolvedByIdentity.clear()
}
