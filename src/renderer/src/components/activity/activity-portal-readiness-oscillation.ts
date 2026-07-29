export type ActivityPortalReadinessStatus = 'loading' | 'ready' | 'unavailable'

// Why: React throws #185 ("Maximum update depth exceeded") once 50 nested SYNC
// updates land on one root. Readiness updates run from useLayoutEffect, so a
// loading<->unavailable flip-flop rides that sync lane and saturates the
// counter. nestedUpdateCount is global per ROOT, so the throw then lands on
// whichever unrelated component sets state next -- which is why this cluster
// surfaced under four different error boundaries. Latch well below 50 (two
// readiness hooks share the budget) but above the flip or two a legitimately
// slow terminal produces while xterm attaches.
export const ACTIVITY_PORTAL_READINESS_MAX_FLIPS = 8

export type ActivityPortalReadinessLatch = {
  next: (status: ActivityPortalReadinessStatus) => ActivityPortalReadinessStatus
}

/**
 * Bounds a loading<->unavailable oscillation for one readiness subscription.
 *
 * Why: defense in depth. Any DOM conflation that makes 'ready' unreachable
 * while 'unavailable' stays reachable spins forever; latching degrades that one
 * Activity pane instead of crashing the renderer.
 *
 * Scope: callers create one latch per (target, paneKey) subscription, so this
 * only bounds a spin *within* one subscription. A cycle that also flips paneKey
 * rebuilds the latch each pass and stays unbounded; Activity cannot produce one
 * because displayedPaneKey only ever advances toward the selected pane.
 */
export function createActivityPortalReadinessLatch(): ActivityPortalReadinessLatch {
  let lastStatus: ActivityPortalReadinessStatus | null = null
  let flips = 0
  let latched = false

  return {
    next(status) {
      // Why 'ready' also releases the latch: it is never part of the
      // pathological cycle, so a ready-free spin can never reach it — and the
      // subscription is rebuilt only when target/paneKey change, so a latch
      // that never released would pin "Terminal unavailable" over a terminal
      // that churned during a slow attach and then genuinely came up.
      if (status === 'ready') {
        lastStatus = status
        flips = 0
        latched = false
        return status
      }
      if (latched) {
        return 'unavailable'
      }
      if (lastStatus !== null && lastStatus !== status) {
        flips += 1
      }
      lastStatus = status
      if (flips >= ACTIVITY_PORTAL_READINESS_MAX_FLIPS) {
        latched = true
        return 'unavailable'
      }
      return status
    }
  }
}
