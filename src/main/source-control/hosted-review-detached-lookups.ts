import { MAX_DETACHED_LOOKUPS, MAX_DETACHED_LOOKUPS_PER_KEY } from './hosted-review-refresh-pacing'

/**
 * Accounting for lookups the deadline detached (P1-D).
 *
 * Nothing under the hosted-review funnel can be cancelled, so a detached lookup
 * runs until it settles — or forever, on a wedged host. Counting them is what
 * stops every deadline-plus-backoff cycle from stranding another one: past the
 * cap the branch answers unavailable instead of spawning a duplicate zombie.
 */
const detachedByKey = new Map<string, number>()
let detachedTotal = 0

export function noteDetachedLookup(key: string): void {
  detachedByKey.set(key, (detachedByKey.get(key) ?? 0) + 1)
  detachedTotal += 1
}

/** Called when a detached lookup finally settles, freeing its slot. */
export function settleDetachedLookup(key: string): void {
  const remaining = (detachedByKey.get(key) ?? 0) - 1
  if (remaining > 0) {
    detachedByKey.set(key, remaining)
  } else {
    detachedByKey.delete(key)
  }
  detachedTotal = Math.max(0, detachedTotal - 1)
}

/** False once this branch — or the process — has stranded too many unsettled lookups. */
export function hasDetachedLookupCapacity(key: string): boolean {
  return (
    (detachedByKey.get(key) ?? 0) < MAX_DETACHED_LOOKUPS_PER_KEY &&
    detachedTotal < MAX_DETACHED_LOOKUPS
  )
}

/** @internal - exposed for tests only */
export function __resetDetachedHostedReviewLookupsForTests(): void {
  detachedByKey.clear()
  detachedTotal = 0
}
