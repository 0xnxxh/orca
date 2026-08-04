import { createActivityPortalChurnBudget } from './activity-portal-churn-budget'

export type ActivityPortalReadinessStatus = 'loading' | 'ready' | 'unavailable'

// Why: stop a subscription from repainting forever after frame coalescing breaks its sync cascade.
export const ACTIVITY_PORTAL_READINESS_MAX_FLIPS = 8
/**
 * How fast the flips must arrive to count as a repaint loop rather than a person.
 *
 * Why this tight: the latch outlives any one subscription, so anything a user can reach by hand would
 * let their thread-hopping answer 'unavailable' for the next pane. The field loop ran 239 renders in
 * 847ms (~8 flips per 28ms), so 500ms still catches it with >15x margin, while spending the budget by
 * hand would take 16 selections a second. It doubles as the hold: a live loop refills the window far
 * faster than it drains, so the latch stays engaged until the churn itself stops.
 */
export const ACTIVITY_PORTAL_READINESS_BURST_WINDOW_MS = 500

export type ActivityPortalReadinessLatch = {
  next: (status: ActivityPortalReadinessStatus) => ActivityPortalReadinessStatus
}

/**
 * Bounds non-ready status flips for one readiness subscriber.
 *
 * Why no pane/target/tab key: the swap effect rewrites the slot element and the pane key together on
 * every oscillation step, so any identity the latch keyed on would be toggled by the loop it bounds.
 */
export function createActivityPortalReadinessLatch(
  now: () => number = () => Date.now()
): ActivityPortalReadinessLatch {
  let lastStatus: ActivityPortalReadinessStatus | null = null
  const flipBudget = createActivityPortalChurnBudget({
    limit: ACTIVITY_PORTAL_READINESS_MAX_FLIPS,
    windowMs: ACTIVITY_PORTAL_READINESS_BURST_WINDOW_MS,
    now
  })

  return {
    next(status) {
      // Why: a slow terminal may become ready after exhausting the flip budget.
      if (status === 'ready') {
        lastStatus = status
        flipBudget.clear()
        return status
      }
      // Why count the probe's status, not the latched output: a DOM that keeps oscillating keeps
      // feeding the budget, so the latch holds until the churn itself stops.
      const flipped = lastStatus !== null && lastStatus !== status
      lastStatus = status
      const spent = flipped ? flipBudget.record() : flipBudget.isSpent()
      return spent ? 'unavailable' : status
    }
  }
}
