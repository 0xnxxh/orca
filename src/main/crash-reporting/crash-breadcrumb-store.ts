import {
  sanitizeCrashReportBreadcrumbs,
  sanitizeCrashReportDetails,
  type CrashReportBreadcrumbData,
  type CrashReportBreadcrumb,
  type RendererSurface
} from '../../shared/crash-reporting'

const MAX_BREADCRUMBS = 30
// Why: retain all four thresholds for both renderer surfaces.
const MAX_RETAINED_BREADCRUMBS = 8
// Why: coalesceKey embeds an open-string agentType (length-trimmed only, never
// enum-checked), so the key space is unbounded over a long multi-agent/SSH session.
// Bound the coalesce map the same way ProcessGoneDedupe bounds its key map.
const MAX_COALESCE_KEYS = 128

type CoalescedBreadcrumbState = {
  recordedAt: number
  suppressed: number
  /** Ring entry this key owns, refreshed in place while suppressing. */
  emitted?: CrashReportBreadcrumb
  /** Newest suppressed payload, sanitized only if a snapshot actually asks for it. */
  pending?: CrashReportBreadcrumbData
}

let breadcrumbs: CrashReportBreadcrumb[] = []
let retainedBreadcrumbs = new Map<string, CrashReportBreadcrumb>()
let coalescedBreadcrumbs = new Map<string, CoalescedBreadcrumbState>()

function retainedBreadcrumbKey(breadcrumb: CrashReportBreadcrumb): string | null {
  if (breadcrumb.name !== 'renderer_memory_highwater') {
    return null
  }
  const surface = breadcrumb.data?.rendererSurface
  const threshold = breadcrumb.data?.thresholdPct
  return `${breadcrumb.name}:${String(surface)}:${String(threshold)}`
}

function evictOldestRetainedBreadcrumbs(): void {
  while (retainedBreadcrumbs.size > MAX_RETAINED_BREADCRUMBS) {
    const oldestKey = retainedBreadcrumbs.keys().next()
    if (oldestKey.done) {
      break
    }
    retainedBreadcrumbs.delete(oldestKey.value)
  }
}

/** Returns the stored breadcrumb so coalescing can refresh the entry it owns. */
export function recordCrashBreadcrumb(
  name: string,
  data?: CrashReportBreadcrumbData
): CrashReportBreadcrumb | undefined {
  const sanitized = sanitizeCrashReportBreadcrumbs([
    {
      createdAt: new Date().toISOString(),
      name,
      data
    }
  ])
  const breadcrumb = sanitized?.[0]
  if (!breadcrumb) {
    return
  }
  const retainedKey = retainedBreadcrumbKey(breadcrumb)
  if (retainedKey) {
    retainedBreadcrumbs.delete(retainedKey)
    retainedBreadcrumbs.set(retainedKey, breadcrumb)
    evictOldestRetainedBreadcrumbs()
    return breadcrumb
  }
  breadcrumbs.push(breadcrumb)
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.shift()
  }
  return breadcrumb
}

export function recordCoalescedCrashBreadcrumb({
  name,
  data,
  coalesceKey,
  minIntervalMs
}: {
  name: string
  data?: CrashReportBreadcrumbData
  coalesceKey: string
  minIntervalMs: number
}): { suppressedSinceLast: number } | undefined {
  const now = Date.now()
  const previous = coalescedBreadcrumbs.get(coalesceKey)
  if (previous && now - previous.recordedAt < minIntervalMs) {
    previous.suppressed += 1
    // Stash the newest payload for the entry this key already owns: the burst
    // still costs exactly one ring slot, but the retained crumb ends up
    // describing the latest event plus a running count instead of freezing the
    // first. Without this, a burst that grows (pane 1 exhausts, then 33 more)
    // leaves a census reading `livePanes: 1` — the "one pane looping" misread
    // this coalescing was built to prevent. Sanitizing here would put that cost
    // on every suppressed hit of a 1459/min crash loop; the snapshot resolves it
    // once instead, on the rare path that actually reads breadcrumbs.
    if (previous.emitted) {
      previous.pending = data
    }
    // Re-anchor recency without touching recordedAt: a suppressed key is the
    // hottest key in the map, but only the emit path below moves position, so
    // a continuously-suppressed key would keep its original slot and be first
    // out under high-cardinality churn. recordedAt stays put so the suppression
    // window still expires on schedule instead of renewing on every hit.
    coalescedBreadcrumbs.delete(coalesceKey)
    coalescedBreadcrumbs.set(coalesceKey, previous)
    return undefined
  }

  // Drop entries past their suppression window (they can no longer coalesce
  // anything) and LRU-cap the rest. delete-then-set keeps insertion order =
  // recency so only genuinely idle keys are evicted. Resolve first: an expiring
  // key is about to lose its only handle on the ring entry it owns.
  for (const [key, entry] of coalescedBreadcrumbs) {
    if (now - entry.recordedAt >= minIntervalMs) {
      // Why the key check: this key is about to emit a fresh crumb carrying
      // `suppressedSinceLast`, so folding the same events into its old slot
      // too would report one burst twice.
      if (key !== coalesceKey) {
        resolvePendingCoalescedBreadcrumb(entry)
      }
      coalescedBreadcrumbs.delete(key)
    }
  }
  coalescedBreadcrumbs.delete(coalesceKey)
  const state: CoalescedBreadcrumbState = { recordedAt: now, suppressed: 0 }
  coalescedBreadcrumbs.set(coalesceKey, state)
  while (coalescedBreadcrumbs.size > MAX_COALESCE_KEYS) {
    const oldest = coalescedBreadcrumbs.entries().next()
    if (oldest.done) {
      break
    }
    resolvePendingCoalescedBreadcrumb(oldest.value[1])
    coalescedBreadcrumbs.delete(oldest.value[0])
  }
  const suppressedSinceLast = previous?.suppressed ?? 0
  state.emitted = recordCrashBreadcrumb(
    name,
    suppressedSinceLast > 0 ? { ...data, suppressedSinceLast } : data
  )
  return { suppressedSinceLast }
}

/** Fold a key's newest suppressed payload into the ring entry it owns. */
function resolvePendingCoalescedBreadcrumb(state: CoalescedBreadcrumbState): void {
  if (!state.pending || !state.emitted) {
    return
  }
  state.emitted.data = sanitizeCrashReportDetails({
    ...state.pending,
    suppressedSinceLast: state.suppressed
  })
  state.pending = undefined
}

function resolveAllPendingCoalescedBreadcrumbs(): void {
  for (const state of coalescedBreadcrumbs.values()) {
    resolvePendingCoalescedBreadcrumb(state)
  }
}

/**
 * Why: retained profiles are keyed by surface+threshold with no generation, and
 * a renderer reload resets the renderer-side one-shot guard while this store
 * survives. Without dropping them at process-gone, the next renderer's crash
 * inherits the dead one's heap profiles — reading as "OOM at a tiny heap".
 *
 * Scope the clear to the dead surface: a popout that outlives the main window
 * never re-emits its own profiles (its one-shot guard is still armed).
 */
export function clearRetainedHighwaterBreadcrumbs(options?: { surface?: RendererSurface }): void {
  const surface = options?.surface
  if (surface === undefined) {
    retainedBreadcrumbs.clear()
    return
  }
  for (const [key, breadcrumb] of retainedBreadcrumbs) {
    const breadcrumbSurface = breadcrumb.data?.rendererSurface
    // Why: an unattributed profile has no owner that could re-emit it, so the
    // dying renderer takes it rather than leaving it to poison the next report.
    if (typeof breadcrumbSurface !== 'string' || breadcrumbSurface === surface) {
      retainedBreadcrumbs.delete(key)
    }
  }
}

/**
 * Why: process-gone clears retained profiles eagerly so the replacement renderer
 * starts clean, but a failed persist releases the dedupe claim for a retry — and
 * the retry re-snapshots. Without re-seeding, that retry writes a durable report
 * with every heap profile missing.
 */
export function restoreRetainedHighwaterBreadcrumbs(snapshot: CrashReportBreadcrumb[]): void {
  const restored = new Map<string, CrashReportBreadcrumb>()
  for (const breadcrumb of snapshot) {
    const key = retainedBreadcrumbKey(breadcrumb)
    // Why: anything the live renderer already recorded for this key is newer.
    if (key !== null && !retainedBreadcrumbs.has(key)) {
      restored.set(key, breadcrumb)
    }
  }
  if (restored.size === 0) {
    return
  }
  // Restored profiles predate the live entries; insertion order is eviction order.
  for (const [key, breadcrumb] of retainedBreadcrumbs) {
    restored.set(key, breadcrumb)
  }
  retainedBreadcrumbs = restored
  evictOldestRetainedBreadcrumbs()
}

export function getCrashBreadcrumbSnapshot(): CrashReportBreadcrumb[] {
  resolveAllPendingCoalescedBreadcrumbs()
  // Why: long sessions must retain threshold profiles without growing the 30-entry budget.
  const retained = [...retainedBreadcrumbs.values()]
  const recent = breadcrumbs.slice(-(MAX_BREADCRUMBS - retained.length))
  return [...retained, ...recent]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((breadcrumb) => ({
      ...breadcrumb,
      ...(breadcrumb.data ? { data: { ...breadcrumb.data } } : {})
    }))
}

export function clearCrashBreadcrumbsForTest(): void {
  breadcrumbs = []
  retainedBreadcrumbs = new Map()
  coalescedBreadcrumbs = new Map()
}

export function getCoalescedKeyCountForTest(): number {
  return coalescedBreadcrumbs.size
}
