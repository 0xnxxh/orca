import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('crash/hang runtime startup owner', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('fails closed before installation', async () => {
    const {
      getCrashHangRuntimeStartupCapability,
      getCrashHangRuntimeStartupCapabilityIfInstalled
    } = await import('./crash-hang-runtime-startup-owner')

    expect(getCrashHangRuntimeStartupCapabilityIfInstalled()).toBeNull()
    expect(() => getCrashHangRuntimeStartupCapability()).toThrow(
      'Crash/hang runtime capability must be initialized before use'
    )
  })

  it('returns the exact installed capability identity', async () => {
    const {
      getCrashHangRuntimeStartupCapability,
      getCrashHangRuntimeStartupCapabilityIfInstalled,
      installCrashHangRuntimeStartupCapability
    } = await import('./crash-hang-runtime-startup-owner')
    const capability = {
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
    }

    installCrashHangRuntimeStartupCapability(capability as never)

    expect(getCrashHangRuntimeStartupCapability()).toBe(capability)
    expect(getCrashHangRuntimeStartupCapabilityIfInstalled()).toBe(capability)
  })
})
