/**
 * Sliding-window burst budget for the Activity portal's readiness repaint loop.
 *
 * Why not a plain counter: a slot swap re-targets the readiness subscription, so a budget scoped to a
 * subscription, pane key or tab id is restarted by the very churn it must bound. The budget is owned
 * for the whole page mount and bounds events *per window* instead, so it neither accumulates across a
 * session nor lets a spent budget answer for a later slow attach (SSH/relay panes take seconds to
 * come up) once the churn stops.
 */
export type ActivityPortalChurnBudget = {
  /** Records one churn event; returns whether the budget is spent afterwards. */
  record: () => boolean
  /** True while the window still holds a full burst. */
  isSpent: () => boolean
  clear: () => void
}

export function createActivityPortalChurnBudget(args: {
  limit: number
  windowMs: number
  now?: () => number
}): ActivityPortalChurnBudget {
  const { limit, windowMs, now = () => Date.now() } = args
  // Why capped at `limit`: an oscillation can fire thousands of events per window, and only the most
  // recent `limit` of them can ever decide the verdict.
  let eventsAt: number[] = []

  const prune = (at: number): void => {
    // Why drop future stamps: Date.now() jumps backwards on NTP/sleep-wake, and a stale future stamp
    // would otherwise hold the budget spent for a whole window after the jump.
    eventsAt = eventsAt.filter((eventAt) => eventAt > at - windowMs && eventAt <= at)
  }

  return {
    record() {
      const at = now()
      prune(at)
      eventsAt.push(at)
      if (eventsAt.length > limit) {
        eventsAt.shift()
      }
      return eventsAt.length >= limit
    },
    isSpent() {
      prune(now())
      return eventsAt.length >= limit
    },
    clear() {
      eventsAt = []
    }
  }
}
