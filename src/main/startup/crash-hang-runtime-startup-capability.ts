import {
  recordCoalescedCrashBreadcrumb,
  recordCrashBreadcrumb
} from '../crash-reporting/crash-breadcrumb-store'
import { CrashReportStore } from '../crash-reporting/crash-report-store'
import { recordDurableCrashBreadcrumb } from '../crash-reporting/durable-crash-breadcrumb'
import { getMainProcessLifecycleIdentity } from '../crash-reporting/main-process-lifecycle-identity'
import { shouldRecoverRendererAfterProcessGone } from '../crash-reporting/process-gone-classification'
import { recordProcessGoneCrash } from '../crash-reporting/process-gone-recorder'
import {
  consumeHangDetectionMarker,
  hangDetectionMarkerPath
} from '../hang-watchdog/hang-detection-marker'
import { installMainThreadHangWatchdog } from '../hang-watchdog/main-thread-hang-watchdog'

export type { CrashReportStore } from '../crash-reporting/crash-report-store'
export type { ExpectedTeardownScope } from '../crash-reporting/process-gone-classification'

export type CrashHangRuntimeStartupCapability = {
  consumeHangDetectionMarker: typeof consumeHangDetectionMarker
  CrashReportStore: typeof CrashReportStore
  getMainProcessLifecycleIdentity: typeof getMainProcessLifecycleIdentity
  hangDetectionMarkerPath: typeof hangDetectionMarkerPath
  installMainThreadHangWatchdog: typeof installMainThreadHangWatchdog
  recordCoalescedCrashBreadcrumb: typeof recordCoalescedCrashBreadcrumb
  recordCrashBreadcrumb: typeof recordCrashBreadcrumb
  recordDurableCrashBreadcrumb: typeof recordDurableCrashBreadcrumb
  recordProcessGoneCrash: typeof recordProcessGoneCrash
  shouldRecoverRendererAfterProcessGone: typeof shouldRecoverRendererAfterProcessGone
}

export function createCrashHangRuntimeStartupCapability(): CrashHangRuntimeStartupCapability {
  return {
    consumeHangDetectionMarker,
    CrashReportStore,
    getMainProcessLifecycleIdentity,
    hangDetectionMarkerPath,
    installMainThreadHangWatchdog,
    recordCoalescedCrashBreadcrumb,
    recordCrashBreadcrumb,
    recordDurableCrashBreadcrumb,
    recordProcessGoneCrash,
    shouldRecoverRendererAfterProcessGone
  }
}
