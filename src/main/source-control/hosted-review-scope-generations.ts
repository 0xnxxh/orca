import { MAX_BRANCH_MAP_ENTRIES } from './hosted-review-refresh-pacing'

/**
 * Per-repo invalidation counter for hosted-review lookups (#11532).
 *
 * A lookup that was already out when Orca opened a review has an answer older
 * than the invalidation, so it must not store. Comparing the generation it
 * started at against the current one is what tells the two apart.
 */
const scopeGenerations = new Map<string, number>()

export function scopeGeneration(scope: string): number {
  return scopeGenerations.get(scope) ?? 0
}

export function bumpScopeGeneration(scope: string): void {
  const next = scopeGeneration(scope) + 1
  scopeGenerations.delete(scope)
  scopeGenerations.set(scope, next)
  // Why: an evicted scope reads as generation 0, which only makes a lookup in
  // flight at eviction discard its result — a wasted call, never a stale one.
  while (scopeGenerations.size > MAX_BRANCH_MAP_ENTRIES) {
    const oldest = scopeGenerations.keys().next().value
    if (oldest === undefined) {
      break
    }
    scopeGenerations.delete(oldest)
  }
}

/** @internal - exposed for tests only */
export function __resetHostedReviewScopeGenerationsForTests(): void {
  scopeGenerations.clear()
}
