import type { CrashReportStore } from './crash-report-store'
import { recordDurableCrashBreadcrumb } from './durable-crash-breadcrumb'

export const RENDERER_BOOTSTRAP_RENDERED_BREADCRUMB = 'renderer_bootstrap_rendered'

// Why: field traces show crash -> reload -> React bootstrap under 1.5s; this only
// has to survive a loaded machine, and must expire before an unrelated boot.
const RENDERER_RECOVERY_OUTCOME_WINDOW_MS = 30_000

let recoveryReloadIssuedAtMs: number | null = null

export function noteRendererRecoveryReloadIssued(nowMs = Date.now()): void {
  recoveryReloadIssuedAtMs = nowMs
}

function takeRendererRecoveryReloadIssuedAt(nowMs: number): number | null {
  const issuedAtMs = recoveryReloadIssuedAtMs
  recoveryReloadIssuedAtMs = null
  if (issuedAtMs === null || nowMs - issuedAtMs > RENDERER_RECOVERY_OUTCOME_WINDOW_MS) {
    return null
  }
  return issuedAtMs
}

type RecoveredCrashReportStore = Pick<CrashReportStore, 'markRendererCrashesAutoRecovered'>

/**
 * Resolve renderer crash reports that an auto-recovery reload actually healed.
 *
 * Why: this must stay synchronous up to the store call so the write is queued
 * before the recovered renderer's getLatestPending read drains the same chain.
 */
export function resolveRecoveredRendererCrashReports(
  store: RecoveredCrashReportStore,
  nowMs = Date.now()
): void {
  const issuedAtMs = takeRendererRecoveryReloadIssuedAt(nowMs)
  if (issuedAtMs === null) {
    return
  }
  void store
    .markRendererCrashesAutoRecovered(issuedAtMs - RENDERER_RECOVERY_OUTCOME_WINDOW_MS)
    .then((resolved) => {
      if (resolved.length === 0) {
        return
      }
      recordDurableCrashBreadcrumb('renderer_crash_auto_recovered', {
        resolvedReportCount: resolved.length,
        recoveryLatencyMs: nowMs - issuedAtMs
      })
    })
    .catch((error) => {
      console.error('[crash-reporting] Failed to resolve auto-recovered crash reports:', error)
    })
}

export function _resetRendererRecoveryOutcomeForTests(): void {
  recoveryReloadIssuedAtMs = null
}
