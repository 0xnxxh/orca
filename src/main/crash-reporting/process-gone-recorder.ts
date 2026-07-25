import os from 'node:os'
import { app } from 'electron'
import {
  isCrashReportReason,
  sanitizeCrashReportString,
  type CrashReportBreadcrumbData
} from '../../shared/crash-reporting'
import type { CrashReportStore } from './crash-report-store'
import { getCrashBreadcrumbSnapshot } from './crash-breadcrumb-store'
import {
  recordCoalescedDurableCrashBreadcrumb,
  recordDurableCrashBreadcrumb
} from './durable-crash-breadcrumb'
import {
  shouldRecordProcessGoneCrash,
  type ExpectedTeardownScope,
  type ProcessGoneSource
} from './process-gone-classification'
import {
  buildProcessGoneCrashDetails,
  buildSuppressedProcessGoneBreadcrumbData
} from './process-gone-diagnostics'
import {
  getProcessGoneDedupeKey,
  processGoneDedupe,
  type ProcessGoneDedupe
} from './process-gone-dedupe'
import { getGpuInfoSnapshot } from './gpu-info-snapshot'
import { getMainProcessLifecycleIdentity } from './main-process-lifecycle-identity'
import { flushActiveSink, startSpan } from '../observability/tracer'

export type ProcessGoneCrashEvent = {
  source: ProcessGoneSource
  processType: string
  reason: string
  exitCode: number | null
  expectedTeardown: ExpectedTeardownScope
  details: Record<string, unknown>
  /** True when this launch already runs a GPU fallback tier, so GPU deaths stop counting as churn. */
  gpuFallbackActive?: boolean
}

type CrashReportRecorderStore = Pick<CrashReportStore, 'record'>

// Why: the coalesce map prunes every key against the calling window, so a shorter
// one here would weaken the other 30s coalescers. Stay uniform with them.
const SUPPRESSED_PROCESS_GONE_COALESCE_MS = 30_000

// Why: a GPU crash loop under the fallback would rewrite crash-reports.json every
// dedupe window for the rest of the session; the first few reports carry all the
// triage signal (driver identity, tier), the rest are pure disk churn.
const MAX_GPU_FALLBACK_CRASH_REPORTS_PER_LAUNCH = 3
let gpuFallbackCrashReportsThisLaunch = 0

export function resetGpuFallbackCrashReportBudgetForTesting(): void {
  gpuFallbackCrashReportsThisLaunch = 0
}

function countsAgainstGpuFallbackReportBudget(event: ProcessGoneCrashEvent): boolean {
  return (
    event.gpuFallbackActive === true &&
    event.source === 'child' &&
    event.processType.toLowerCase() === 'gpu'
  )
}

function processGoneBreadcrumbData(event: ProcessGoneCrashEvent) {
  return buildSuppressedProcessGoneBreadcrumbData(event)
}

// Why: key off the emitted breadcrumb, not the crash-report dedupe key, so two
// different recoverable services can never suppress each other's evidence.
function suppressedProcessGoneCoalesceKey(data: CrashReportBreadcrumbData): string {
  return JSON.stringify([
    data.source,
    data.processType,
    data.reason,
    data.exitCode,
    data.expectedTeardown,
    data.serviceName ?? null,
    data.name ?? null,
    data.type ?? null
  ])
}

function persistFailureData(event: ProcessGoneCrashEvent, error: unknown) {
  const errorCode =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined
  return {
    ...processGoneBreadcrumbData(event),
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: sanitizeCrashReportString(error instanceof Error ? error.message : String(error)),
    ...(errorCode ? { errorCode } : {})
  }
}

export function recordProcessGoneCrash(
  store: CrashReportRecorderStore | null,
  event: ProcessGoneCrashEvent,
  dedupe: ProcessGoneDedupe = processGoneDedupe
): void {
  if (!isCrashReportReason(event.reason)) {
    return
  }
  if (
    !shouldRecordProcessGoneCrash({
      source: event.source,
      processType: event.processType,
      serviceName:
        typeof event.details.serviceName === 'string' ? event.details.serviceName : undefined,
      reason: event.reason,
      exitCode: event.exitCode,
      expectedTeardown: event.expectedTeardown,
      gpuFallbackActive: event.gpuFallbackActive
    })
  ) {
    // Why: Chromium can crash-loop a recoverable child (network service seen at
    // 1459/min) and each suppressed event costs a span plus a forced disk flush,
    // which both floods the 30-entry ring and evicts the real pre-crash trail.
    const suppressedData = processGoneBreadcrumbData(event)
    recordCoalescedDurableCrashBreadcrumb({
      name: 'process_gone_suppressed',
      data: suppressedData,
      coalesceKey: suppressedProcessGoneCoalesceKey(suppressedData),
      minIntervalMs: SUPPRESSED_PROCESS_GONE_COALESCE_MS
    })
    return
  }
  if (!store) {
    recordDurableCrashBreadcrumb(
      'crash_report_store_unavailable',
      processGoneBreadcrumbData(event),
      'Crash report store unavailable'
    )
    return
  }

  const gpuFallbackBudgeted = countsAgainstGpuFallbackReportBudget(event)
  if (
    gpuFallbackBudgeted &&
    gpuFallbackCrashReportsThisLaunch >= MAX_GPU_FALLBACK_CRASH_REPORTS_PER_LAUNCH
  ) {
    recordDurableCrashBreadcrumb('process_gone_suppressed', {
      ...processGoneBreadcrumbData(event),
      suppressedBy: 'gpu_fallback_report_budget'
    })
    return
  }

  const key = getProcessGoneDedupeKey(event.source, event.processType, event.reason, event.exitCode)
  const claim = dedupe.tryClaim(key)
  if (!claim) {
    return
  }
  if (gpuFallbackBudgeted) {
    gpuFallbackCrashReportsThisLaunch += 1
  }
  const mainProcessLifecycle = getMainProcessLifecycleIdentity()
  // Why: GPU and renderer deaths are the ones triage needs driver identity for;
  // every other child type would just pad the report.
  const gpuIdentity =
    event.source === 'renderer' || event.processType.toLowerCase() === 'gpu'
      ? (getGpuInfoSnapshot() ?? {})
      : {}
  const crashDetails = buildProcessGoneCrashDetails({
    ...event.details,
    ...gpuIdentity,
    ...mainProcessLifecycle
  })
  const breadcrumbs = getCrashBreadcrumbSnapshot()
  const span = startSpan('electron.process_gone', {
    attributes: {
      'crash.source': event.source,
      'crash.process_type': event.processType,
      'crash.reason': event.reason,
      ...(event.exitCode !== null ? { 'crash.exit_code': event.exitCode } : {}),
      'app.version': app.getVersion(),
      platform: process.platform,
      osRelease: os.release(),
      arch: process.arch,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      'app.main_process.pid': mainProcessLifecycle.mainProcessPid,
      'app.main_process.launch_id': mainProcessLifecycle.mainProcessLaunchId,
      'app.main_process.started_at': mainProcessLifecycle.mainProcessStartedAt,
      details: crashDetails,
      breadcrumbs
    }
  })
  // Why: a renderer crash can be followed by another process exit before the
  // trace batch window closes, so make the primary signal durable immediately.
  span.fail(
    `${event.source} process gone: ${event.processType} ${event.reason} (${event.exitCode ?? 'unknown'})`
  )
  flushActiveSink()

  void store
    .record({
      source: event.source,
      processType: event.processType,
      reason: event.reason,
      exitCode: event.exitCode,
      appVersion: app.getVersion(),
      platform: process.platform,
      osRelease: os.release(),
      arch: process.arch,
      electronVersion: process.versions.electron ?? 'unknown',
      chromeVersion: process.versions.chrome ?? 'unknown',
      details: crashDetails,
      breadcrumbs
    })
    .catch((error) => {
      dedupe.release(claim)
      if (gpuFallbackBudgeted) {
        gpuFallbackCrashReportsThisLaunch -= 1
      }
      console.error('[crash-reporting] Failed to persist crash report:', error)
      const data = persistFailureData(event, error)
      recordDurableCrashBreadcrumb(
        'crash_report_persist_failed',
        data,
        `${String(data.errorName)}: ${String(data.errorMessage)}`
      )
    })
}
