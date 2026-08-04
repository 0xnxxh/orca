/**
 * Cold-park verdict flip telemetry and damping.
 *
 * Why: crash cluster C5 (React #185 in TerminalPaneOverlayLayer) is a park-flip
 * loop — the veto (canWatcherCoverParkedTerminalTab) is re-derived from store
 * and registry state that mounting/unmounting the very pane the verdict
 * controls rewrites, so the verdict can alternate at render cadence. Field
 * bundles carry 12 flips in as little as 348ms, which falsified the original
 * "deliberately no damping" stance, so the record is a policy input too: a tab
 * whose verdict bursts pins to NOT-parked for one window (the safe side — a
 * mounted pane never goes silent for bells, titles or completions).
 *
 * Why two thresholds: React bails on *commits*, not on flips, and one flip in
 * the real cycle costs many commits (pane-connect updateTabPtyId, the
 * watcher-sync writes, the overlay's own subscriber renders). The damping
 * trigger is therefore derived from React's commit budget and is far tighter
 * than the breadcrumb notice limit, which exists only to keep the crumb rare.
 *
 * Reading the signal: breadcrumbs also emit a durable `renderer.breadcrumb`
 * trace span, so this is queryable without waiting for a crash bundle.
 * `trigger: 'burst'` is the damped render loop (and always pins); `'window'` is
 * slow churn that never got near React's bail. A still-churning tab re-pins
 * once per window, so a repeating crumb means the oscillator is still live.
 */
import { recordRendererCrashBreadcrumb } from '@/lib/crash-breadcrumb-recorder'

export const TERMINAL_TAB_PARK_FLIP_WINDOW_MS = 60_000
/** Flips per window that no sane park policy should reach. Breadcrumb only. */
export const TERMINAL_TAB_PARK_FLIP_NOTICE_LIMIT = 12

/** react-dom 19.2.x NESTED_UPDATE_LIMIT — the commit budget a loop must beat. */
const REACT_NESTED_UPDATE_LIMIT = 50
/**
 * Commits the pinned verdict still costs to settle after damping engages — the
 * pin lands in the passive effect that observes the burst, so the verdict
 * settles one flip later. Measured at 5 by terminal-cold-park-verdict-loop.
 */
const PARK_PIN_SETTLE_COMMITS = 6
/**
 * Commits one verdict flip costs, worst case: the pane mount/unmount, the
 * pane-connect updateTabPtyId, the parked-watcher writes (clearTabLaunchAgent,
 * setTabLayout, updateTabTitle) and the overlay's zustand subscriber renders.
 * Raising this tightens the burst limit automatically — never hand-tune both.
 */
export const TERMINAL_TAB_PARK_FLIP_COMMIT_COST = 12
/**
 * Flips that must pin before React throws #185. Deliberately NOT the notice
 * limit: at the commit cost above, 12 flips is ~144 commits, so a notice-limit
 * pin never fires in the field — React bails long before it.
 */
export const TERMINAL_TAB_PARK_FLIP_BURST_LIMIT = Math.max(
  2,
  Math.floor(
    (REACT_NESTED_UPDATE_LIMIT - PARK_PIN_SETTLE_COMMITS) / TERMINAL_TAB_PARK_FLIP_COMMIT_COST
  )
)
/**
 * Burst horizon. Only a render-cadence loop reaches the burst limit inside it:
 * an honest park needs the 30s cold-park hysteresis in one direction, so
 * sub-second park/unpark round trips are always the pathology.
 */
export const TERMINAL_TAB_PARK_FLIP_BURST_WINDOW_MS = 1_000

export type ParkVerdictFlipRecord = {
  parked: boolean
  windowStartMs: number
  flips: number
  notified: boolean
  burstStartMs: number
  burstFlips: number
  /** Set when a flip burst engaged damping; the verdict stays unparked until then. */
  pinnedUntilMs?: number | null
}

function resetFlipWindows(record: ParkVerdictFlipRecord, nowMs: number): void {
  record.windowStartMs = nowMs
  record.flips = 0
  record.notified = false
  record.burstStartMs = nowMs
  record.burstFlips = 0
  record.pinnedUntilMs = null
}

/**
 * When this tab's NOT-parked damping pin expires, or null when it is unpinned.
 * Callers must schedule a recheck at the returned deadline: the pin's whole job
 * is to stop the churn that would otherwise re-run the verdict effect, so
 * without that wakeup nothing ever re-parks the tab. Expiry reopens the window
 * so a still-churning tab re-pins (and re-breadcrumbs) instead of pinning
 * forever on one old burst.
 */
export function getParkVerdictUnparkPinUntilMs(args: {
  records: Map<string, ParkVerdictFlipRecord>
  tabId: string
  nowMs: number
}): number | null {
  const record = args.records.get(args.tabId)
  if (record?.pinnedUntilMs == null) {
    return null
  }
  if (args.nowMs >= record.pinnedUntilMs || args.nowMs < record.windowStartMs) {
    resetFlipWindows(record, args.nowMs)
    return null
  }
  return record.pinnedUntilMs
}

/** Records park-verdict churn per tab; damps bursts and breadcrumbs the rest. */
export function recordParkVerdictFlips(args: {
  records: Map<string, ParkVerdictFlipRecord>
  liveTabIds: ReadonlySet<string>
  nextParkedTabIds: ReadonlySet<string>
  nowMs: number
  flipWindowMs?: number
  noticeLimit?: number
  burstWindowMs?: number
  burstLimit?: number
}): void {
  const {
    records,
    liveTabIds,
    nextParkedTabIds,
    nowMs,
    flipWindowMs = TERMINAL_TAB_PARK_FLIP_WINDOW_MS,
    noticeLimit = TERMINAL_TAB_PARK_FLIP_NOTICE_LIMIT,
    burstWindowMs = TERMINAL_TAB_PARK_FLIP_BURST_WINDOW_MS,
    burstLimit = TERMINAL_TAB_PARK_FLIP_BURST_LIMIT
  } = args

  for (const tabId of Array.from(records.keys())) {
    if (!liveTabIds.has(tabId)) {
      records.delete(tabId)
    }
  }

  for (const tabId of liveTabIds) {
    const parked = nextParkedTabIds.has(tabId)
    const record = records.get(tabId)

    if (!record) {
      records.set(tabId, {
        parked,
        windowStartMs: nowMs,
        flips: 0,
        notified: false,
        burstStartMs: nowMs,
        burstFlips: 0,
        pinnedUntilMs: null
      })
      continue
    }
    if (parked === record.parked) {
      continue
    }

    // Why: Date.now() jumps backwards on NTP/sleep-wake; treat any out-of-range
    // elapsed value as a fresh window rather than trusting the delta.
    const elapsedMs = nowMs - record.windowStartMs
    if (elapsedMs >= flipWindowMs || elapsedMs < 0) {
      resetFlipWindows(record, nowMs)
    }
    const burstElapsedMs = nowMs - record.burstStartMs
    if (burstElapsedMs >= burstWindowMs || burstElapsedMs < 0) {
      record.burstStartMs = nowMs
      record.burstFlips = 0
    }

    record.parked = parked
    record.flips += 1
    record.burstFlips += 1

    if (record.pinnedUntilMs == null && record.burstFlips >= burstLimit) {
      record.pinnedUntilMs = nowMs + flipWindowMs
      recordRendererCrashBreadcrumb('terminal_park_verdict_churn', {
        tabId,
        trigger: 'burst',
        flips: record.burstFlips,
        elapsedMs: nowMs - record.burstStartMs,
        windowMs: burstWindowMs,
        pinnedForMs: flipWindowMs
      })
      continue
    }
    // Why pinnedUntilMs gates this: the burst crumb already reported the same
    // window, so a second crumb would only double the volume the notice limit
    // exists to keep down.
    if (record.pinnedUntilMs == null && !record.notified && record.flips >= noticeLimit) {
      record.notified = true
      // Why: flips is always exactly noticeLimit here, so elapsedMs is the only
      // field that separates slow churn from a burst the damping already caught.
      recordRendererCrashBreadcrumb('terminal_park_verdict_churn', {
        tabId,
        trigger: 'window',
        flips: record.flips,
        elapsedMs: nowMs - record.windowStartMs,
        windowMs: flipWindowMs
      })
    }
  }
}
