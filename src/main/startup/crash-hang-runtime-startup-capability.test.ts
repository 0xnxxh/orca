import { describe, expect, it, vi } from 'vitest'

const crashHangMocks = vi.hoisted(() => ({
  consumeHangDetectionMarker: vi.fn(),
  CrashReportStore: class CrashReportStore {},
  getMainProcessLifecycleIdentity: vi.fn(),
  hangDetectionMarkerPath: vi.fn(),
  installMainThreadHangWatchdog: vi.fn(),
  recordCoalescedCrashBreadcrumb: vi.fn(),
  recordCrashBreadcrumb: vi.fn(),
  recordDurableCrashBreadcrumb: vi.fn(),
  recordProcessGoneCrash: vi.fn(),
  shouldRecoverRendererAfterProcessGone: vi.fn()
}))

vi.mock('../crash-reporting/crash-breadcrumb-store', () => ({
  recordCoalescedCrashBreadcrumb: crashHangMocks.recordCoalescedCrashBreadcrumb,
  recordCrashBreadcrumb: crashHangMocks.recordCrashBreadcrumb
}))
vi.mock('../crash-reporting/crash-report-store', () => ({
  CrashReportStore: crashHangMocks.CrashReportStore
}))
vi.mock('../crash-reporting/durable-crash-breadcrumb', () => ({
  recordDurableCrashBreadcrumb: crashHangMocks.recordDurableCrashBreadcrumb
}))
vi.mock('../crash-reporting/main-process-lifecycle-identity', () => ({
  getMainProcessLifecycleIdentity: crashHangMocks.getMainProcessLifecycleIdentity
}))
vi.mock('../crash-reporting/process-gone-classification', () => ({
  shouldRecoverRendererAfterProcessGone: crashHangMocks.shouldRecoverRendererAfterProcessGone
}))
vi.mock('../crash-reporting/process-gone-recorder', () => ({
  recordProcessGoneCrash: crashHangMocks.recordProcessGoneCrash
}))
vi.mock('../hang-watchdog/hang-detection-marker', () => ({
  consumeHangDetectionMarker: crashHangMocks.consumeHangDetectionMarker,
  hangDetectionMarkerPath: crashHangMocks.hangDetectionMarkerPath
}))
vi.mock('../hang-watchdog/main-thread-hang-watchdog', () => ({
  installMainThreadHangWatchdog: crashHangMocks.installMainThreadHangWatchdog
}))

import { createCrashHangRuntimeStartupCapability } from './crash-hang-runtime-startup-capability'

describe('crash/hang runtime startup capability', () => {
  it('returns every original class and function identity', () => {
    expect(createCrashHangRuntimeStartupCapability()).toEqual(crashHangMocks)
  })
})
