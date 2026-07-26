import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.2.3-test',
    getAppMetrics: () => []
  }
}))

import {
  clearCrashBreadcrumbsForTest,
  getCrashBreadcrumbSnapshot,
  recordCrashBreadcrumb
} from './crash-breadcrumb-store'
import { ProcessGoneDedupe } from './process-gone-dedupe'
import {
  recordProcessGoneCrash,
  resetGpuFallbackCrashReportBudgetForTesting,
  type ProcessGoneCrashEvent
} from './process-gone-recorder'
import { _resetTracerForTests, setActiveSink, type TracerSink } from '../observability/tracer'
import {
  registerGpuIdentitySource,
  resetGpuIdentityCaptureForTesting,
  setGpuInfoSnapshotForTesting
} from './gpu-info-snapshot'

type CapturingSink = TracerSink & { records: unknown[]; flushMock: ReturnType<typeof vi.fn> }

function capturingSink(): CapturingSink {
  const records: unknown[] = []
  const flushMock = vi.fn()
  return {
    records,
    flushMock,
    push: (record) => records.push(record),
    flush: flushMock,
    close: vi.fn()
  }
}

function event(overrides: Partial<ProcessGoneCrashEvent> = {}): ProcessGoneCrashEvent {
  return {
    source: 'renderer',
    processType: 'renderer',
    reason: 'crashed',
    exitCode: 5,
    expectedTeardown: 'none',
    details: { processType: 'renderer' },
    ...overrides
  }
}

let sink: CapturingSink

beforeEach(() => {
  sink = capturingSink()
  setActiveSink(sink)
  clearCrashBreadcrumbsForTest()
  resetGpuFallbackCrashReportBudgetForTesting()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  _resetTracerForTests()
  clearCrashBreadcrumbsForTest()
  setGpuInfoSnapshotForTesting(null)
  resetGpuIdentityCaptureForTesting()
})

describe('recordProcessGoneCrash', () => {
  it('durably records when the crash report store is unavailable', () => {
    recordProcessGoneCrash(null, event(), new ProcessGoneDedupe())

    expect(getCrashBreadcrumbSnapshot()).toEqual([
      expect.objectContaining({
        name: 'crash_report_store_unavailable',
        data: expect.objectContaining({
          source: 'renderer',
          expectedTeardown: 'none'
        })
      })
    ])
    expect(sink.records).toEqual([
      expect.objectContaining({
        name: 'crash.breadcrumb',
        exit: expect.objectContaining({ _tag: 'Failure' })
      })
    ])
    expect(sink.flushMock).toHaveBeenCalledOnce()
  })

  it('durably records why an expected renderer teardown was suppressed', () => {
    const record = vi.fn()

    recordProcessGoneCrash(
      { record } as never,
      event({ reason: 'killed', exitCode: 1, expectedTeardown: 'renderer-reload' }),
      new ProcessGoneDedupe()
    )

    expect(record).not.toHaveBeenCalled()
    expect(getCrashBreadcrumbSnapshot()).toEqual([
      expect.objectContaining({
        name: 'process_gone_suppressed',
        data: expect.objectContaining({ expectedTeardown: 'renderer-reload' })
      })
    ])
    expect(sink.records).toEqual([
      expect.objectContaining({
        name: 'crash.breadcrumb',
        attributes: expect.objectContaining({
          'breadcrumb.name': 'process_gone_suppressed'
        })
      })
    ])
    expect(sink.flushMock).toHaveBeenCalledOnce()
  })

  it('coalesces a recoverable-service crash loop instead of flushing every event', () => {
    const record = vi.fn()
    const dedupe = new ProcessGoneDedupe()
    const networkServiceCrash = event({
      source: 'child',
      processType: 'Utility',
      reason: 'crashed',
      expectedTeardown: 'none',
      details: { serviceName: 'network.mojom.NetworkService', type: 'Utility' }
    })

    // Observed peak in a real diagnostic bundle: 1459 suppressed crashes in one minute.
    for (let i = 0; i < 1_459; i++) {
      recordProcessGoneCrash({ record } as never, networkServiceCrash, dedupe)
    }

    expect(record).not.toHaveBeenCalled()
    expect(sink.records).toHaveLength(1)
    expect(sink.flushMock).toHaveBeenCalledOnce()
    expect(getCrashBreadcrumbSnapshot()).toEqual([
      expect.objectContaining({
        name: 'process_gone_suppressed',
        data: expect.objectContaining({ serviceName: 'network.mojom.NetworkService' })
      })
    ])
  })

  it('keeps the pre-crash breadcrumb trail through a crash loop', () => {
    const dedupe = new ProcessGoneDedupe()
    recordCrashBreadcrumb('renderer_error', { message: 'boom' })

    for (let i = 0; i < 1_459; i++) {
      recordProcessGoneCrash(
        { record: vi.fn() } as never,
        event({
          source: 'child',
          processType: 'Utility',
          reason: 'crashed',
          details: { serviceName: 'network.mojom.NetworkService' }
        }),
        dedupe
      )
    }

    // Why: the ring holds 30 entries, so an uncoalesced loop evicts every real breadcrumb.
    expect(getCrashBreadcrumbSnapshot().map((breadcrumb) => breadcrumb.name)).toEqual([
      'renderer_error',
      'process_gone_suppressed'
    ])
  })

  it('reports how many repeats a coalesced suppression stands for', () => {
    const dedupe = new ProcessGoneDedupe()
    const utilityCrash = event({
      source: 'child',
      processType: 'Utility',
      reason: 'crashed',
      details: { serviceName: 'network.mojom.NetworkService' }
    })
    const nowSpy = vi.spyOn(Date, 'now')

    nowSpy.mockReturnValue(0)
    for (let i = 0; i < 700; i++) {
      recordProcessGoneCrash({ record: vi.fn() } as never, utilityCrash, dedupe)
    }
    nowSpy.mockReturnValue(30_000)
    recordProcessGoneCrash({ record: vi.fn() } as never, utilityCrash, dedupe)

    expect(getCrashBreadcrumbSnapshot()).toEqual([
      expect.objectContaining({ name: 'process_gone_suppressed' }),
      expect.objectContaining({
        name: 'process_gone_suppressed',
        data: expect.objectContaining({ suppressedSinceLast: 699 })
      })
    ])
    // Why: the ring gets this count from the store itself, so only the span proves
    // the exported telemetry carries it too.
    expect(sink.records).toEqual([
      expect.objectContaining({ name: 'crash.breadcrumb' }),
      expect.objectContaining({
        attributes: expect.objectContaining({
          'breadcrumb.data': expect.objectContaining({ suppressedSinceLast: 699 })
        })
      })
    ])
  })

  it('keeps suppressions with different exit codes separate', () => {
    const dedupe = new ProcessGoneDedupe()
    const utilityCrash = (exitCode: number) =>
      event({
        source: 'child',
        processType: 'Utility',
        reason: 'crashed',
        exitCode,
        details: { serviceName: 'network.mojom.NetworkService' }
      })

    recordProcessGoneCrash({ record: vi.fn() } as never, utilityCrash(11), dedupe)
    recordProcessGoneCrash({ record: vi.fn() } as never, utilityCrash(139), dedupe)

    // Why: a clean shutdown code and a segfault are different failures; collapsing
    // them would hide the second behind the first for a full window.
    expect(getCrashBreadcrumbSnapshot().map((breadcrumb) => breadcrumb.data?.exitCode)).toEqual([
      11, 139
    ])
  })

  it('never lets one recoverable service suppress another service evidence', () => {
    const dedupe = new ProcessGoneDedupe()
    const utilityCrash = (serviceName: string) =>
      event({
        source: 'child',
        processType: 'Utility',
        reason: 'crashed',
        details: { serviceName }
      })

    recordProcessGoneCrash(
      { record: vi.fn() } as never,
      utilityCrash('network.mojom.NetworkService'),
      dedupe
    )
    recordProcessGoneCrash(
      { record: vi.fn() } as never,
      utilityCrash('audio.mojom.AudioService'),
      dedupe
    )

    expect(getCrashBreadcrumbSnapshot().map((breadcrumb) => breadcrumb.data?.serviceName)).toEqual([
      'network.mojom.NetworkService',
      'audio.mojom.AudioService'
    ])
  })

  it('persists a report and flushes the process-gone trace before recovery', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report-1' })

    recordProcessGoneCrash({ record } as never, event(), new ProcessGoneDedupe())

    await vi.waitFor(() => expect(record).toHaveBeenCalledOnce())
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'renderer',
        reason: 'crashed',
        exitCode: 5,
        details: expect.objectContaining({
          mainProcessPid: process.pid,
          mainProcessLaunchId: expect.any(String),
          mainProcessStartedAt: expect.any(String)
        })
      })
    )
    expect(sink.records).toEqual([
      expect.objectContaining({
        name: 'electron.process_gone',
        attributes: expect.objectContaining({
          'app.main_process.pid': process.pid,
          'app.main_process.launch_id': expect.any(String),
          'app.main_process.started_at': expect.any(String)
        }),
        exit: expect.objectContaining({ _tag: 'Failure' })
      })
    ])
    expect(sink.flushMock).toHaveBeenCalledOnce()
  })

  it('still persists the report when the forced trace flush fails', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report-1' })
    sink.flushMock.mockImplementation(() => {
      throw new Error('trace disk unavailable')
    })

    expect(() =>
      recordProcessGoneCrash({ record } as never, event(), new ProcessGoneDedupe())
    ).not.toThrow()
    await vi.waitFor(() => expect(record).toHaveBeenCalledOnce())
  })

  it('still persists the report when the trace sink handoff fails', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report-1' })
    sink.push = () => {
      throw new Error('trace rotation failed')
    }

    expect(() =>
      recordProcessGoneCrash({ record } as never, event(), new ProcessGoneDedupe())
    ).not.toThrow()
    await vi.waitFor(() => expect(record).toHaveBeenCalledOnce())
  })

  it('durably records a sanitized crash-report persistence failure', async () => {
    const persistError = Object.assign(
      new Error('EPERM at C:\\Users\\alice\\AppData\\Roaming\\Orca\\crash-reports.json'),
      { code: 'EPERM' }
    )
    const record = vi.fn().mockRejectedValue(persistError)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    recordProcessGoneCrash({ record } as never, event(), new ProcessGoneDedupe())

    await vi.waitFor(() => {
      expect(getCrashBreadcrumbSnapshot()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'crash_report_persist_failed',
            data: expect.objectContaining({ errorCode: 'EPERM' })
          })
        ])
      )
    })
    expect(sink.records).toHaveLength(2)
    expect(sink.records[1]).toEqual(
      expect.objectContaining({
        name: 'crash.breadcrumb',
        exit: expect.objectContaining({ _tag: 'Failure' })
      })
    )
    expect(JSON.stringify(sink.records)).not.toContain('alice')
    expect(sink.flushMock).toHaveBeenCalledTimes(2)
  })

  it('keeps null persistence rejections inside the fail-open diagnostic path', async () => {
    const record = vi.fn().mockRejectedValue(null)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    recordProcessGoneCrash({ record } as never, event(), new ProcessGoneDedupe())

    await vi.waitFor(() =>
      expect(getCrashBreadcrumbSnapshot()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'crash_report_persist_failed',
            data: expect.objectContaining({ errorName: 'object', errorMessage: 'null' })
          })
        ])
      )
    )
  })

  // Why: a GPU crash loop under the fallback must not rewrite crash-reports.json
  // every dedupe window for the rest of the session.
  it('caps GPU-under-fallback reports per launch and durably records the overflow', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report' })
    const dedupe = new ProcessGoneDedupe()
    const gpuCrash = (exitCode: number): ProcessGoneCrashEvent =>
      event({
        source: 'child',
        processType: 'GPU',
        reason: 'crashed',
        exitCode,
        gpuFallbackActive: true,
        details: { type: 'GPU' }
      })

    for (const exitCode of [1, 2, 3]) {
      recordProcessGoneCrash({ record } as never, gpuCrash(exitCode), dedupe)
    }
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(3))

    recordProcessGoneCrash({ record } as never, gpuCrash(4), dedupe)

    expect(record).toHaveBeenCalledTimes(3)
    expect(getCrashBreadcrumbSnapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'process_gone_suppressed',
          data: expect.objectContaining({ suppressedBy: 'gpu_fallback_report_budget' })
        })
      ])
    )
  })

  it('does not spend GPU-fallback budget on deduped repeats', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report' })
    const dedupe = new ProcessGoneDedupe()
    const gpuCrash = (exitCode: number): ProcessGoneCrashEvent =>
      event({
        source: 'child',
        processType: 'GPU',
        reason: 'crashed',
        exitCode,
        gpuFallbackActive: true,
        details: { type: 'GPU' }
      })

    recordProcessGoneCrash({ record } as never, gpuCrash(1), dedupe)
    recordProcessGoneCrash({ record } as never, gpuCrash(2), dedupe)
    recordProcessGoneCrash({ record } as never, gpuCrash(2), dedupe)
    recordProcessGoneCrash({ record } as never, gpuCrash(3), dedupe)

    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(3))
    expect(getCrashBreadcrumbSnapshot()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ suppressedBy: 'gpu_fallback_report_budget' })
        })
      ])
    )
  })

  it('releases GPU-fallback budget when persistence fails', async () => {
    const record = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValue({ id: 'report' })
    const dedupe = new ProcessGoneDedupe()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const gpuCrash = (exitCode: number): ProcessGoneCrashEvent =>
      event({
        source: 'child',
        processType: 'GPU',
        reason: 'crashed',
        exitCode,
        gpuFallbackActive: true,
        details: { type: 'GPU' }
      })

    recordProcessGoneCrash({ record } as never, gpuCrash(1), dedupe)
    await vi.waitFor(() =>
      expect(getCrashBreadcrumbSnapshot()).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'crash_report_persist_failed' })])
      )
    )

    for (const exitCode of [2, 3, 4]) {
      recordProcessGoneCrash({ record } as never, gpuCrash(exitCode), dedupe)
    }
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(4))
    expect(getCrashBreadcrumbSnapshot()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ suppressedBy: 'gpu_fallback_report_budget' })
        })
      ])
    )
  })

  it('still records renderer crashes after the GPU-fallback budget is spent', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report' })
    const dedupe = new ProcessGoneDedupe()

    for (const exitCode of [1, 2, 3]) {
      recordProcessGoneCrash(
        { record } as never,
        event({
          source: 'child',
          processType: 'GPU',
          reason: 'crashed',
          exitCode,
          gpuFallbackActive: true,
          details: { type: 'GPU' }
        }),
        dedupe
      )
    }
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(3))

    recordProcessGoneCrash({ record } as never, event({ gpuFallbackActive: true }), dedupe)

    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(4))
  })

  // Why: driver identity is the whole point of the GPU snapshot — if it stops reaching
  // crash details, triage silently loses the vendor/device data it was added for.
  it('attaches the GPU identity snapshot to GPU-child crash details', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report' })
    setGpuInfoSnapshotForTesting({ gpuInfoAvailable: true, gpuVendorId: '0x10de' })

    recordProcessGoneCrash(
      { record } as never,
      event({
        source: 'child',
        processType: 'GPU',
        gpuFallbackActive: true,
        details: { type: 'GPU', gpuFallbackTier: 2 }
      }),
      new ProcessGoneDedupe()
    )

    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1))
    expect(record.mock.calls[0][0].details).toEqual(
      expect.objectContaining({ gpuInfoAvailable: true, gpuVendorId: '0x10de' })
    )
  })

  it('attaches the GPU identity snapshot to renderer crash details', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report' })
    setGpuInfoSnapshotForTesting({ gpuInfoAvailable: true, gpuVendorId: '0x10de' })

    recordProcessGoneCrash({ record } as never, event(), new ProcessGoneDedupe())

    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1))
    expect(record.mock.calls[0][0].details).toEqual(
      expect.objectContaining({ gpuInfoAvailable: true, gpuVendorId: '0x10de' })
    )
  })

  // Why: healthy launches never call getGPUInfo — the first crash that needs driver
  // identity is what triggers the capture, and the report still carries the fields.
  it('lazily captures GPU identity on the first crash that needs it', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report' })
    const getGpuInfo = vi
      .fn()
      .mockResolvedValue({ gpuDevice: [{ active: true, vendorId: 32902, deviceId: 15130 }] })
    registerGpuIdentitySource({ getGpuInfo, hardwareAccelerationDisabled: false })

    await recordProcessGoneCrash({ record } as never, event(), new ProcessGoneDedupe())

    expect(getGpuInfo).toHaveBeenCalledWith('basic')
    expect(record).toHaveBeenCalledOnce()
    expect(record.mock.calls[0][0].details).toEqual(
      expect.objectContaining({ gpuInfoAvailable: true, gpuVendorId: '0x8086' })
    )
  })

  it('does not trigger identity capture for non-GPU child crashes', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report' })
    const getGpuInfo = vi.fn()
    registerGpuIdentitySource({ getGpuInfo, hardwareAccelerationDisabled: false })

    await recordProcessGoneCrash(
      { record } as never,
      event({ source: 'child', processType: 'Utility', details: { type: 'Utility' } }),
      new ProcessGoneDedupe()
    )

    expect(getGpuInfo).not.toHaveBeenCalled()
    expect(record).toHaveBeenCalledOnce()
  })

  // Why: the report must not wait out a hung getGPUInfo — the bounded wait expires
  // and the crash persists without identity rather than never.
  it('persists after a bounded wait when the identity capture hangs', async () => {
    vi.useFakeTimers()
    const record = vi.fn().mockResolvedValue({ id: 'report' })
    registerGpuIdentitySource({
      getGpuInfo: () => new Promise(() => {}),
      hardwareAccelerationDisabled: true
    })

    const recorded = recordProcessGoneCrash(
      { record } as never,
      event({
        source: 'child',
        processType: 'GPU',
        gpuFallbackActive: true,
        details: { type: 'GPU' }
      }),
      new ProcessGoneDedupe()
    )
    await vi.advanceTimersByTimeAsync(2_000)
    await recorded

    expect(record).toHaveBeenCalledOnce()
    expect(record.mock.calls[0][0].details).not.toHaveProperty('gpuVendorId')
  })

  // Why: every other child type would just pad the report.
  it('omits the GPU identity snapshot for non-GPU child crashes', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report' })
    setGpuInfoSnapshotForTesting({ gpuInfoAvailable: true, gpuVendorId: '0x10de' })

    recordProcessGoneCrash(
      { record } as never,
      event({ source: 'child', processType: 'Utility', details: { type: 'Utility' } }),
      new ProcessGoneDedupe()
    )

    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1))
    expect(record.mock.calls[0][0].details).not.toHaveProperty('gpuVendorId')
  })

  // Why: the reworded crash dialog keys off a numeric gpuFallbackTier; if sanitization
  // ever dropped or stringified it, isGpuFallbackCrashReport would silently never match.
  it('preserves gpuFallbackTier as a number through sanitization', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report' })

    recordProcessGoneCrash(
      { record } as never,
      event({
        source: 'child',
        processType: 'GPU',
        gpuFallbackActive: true,
        details: { type: 'GPU', gpuFallbackTier: 2 }
      }),
      new ProcessGoneDedupe()
    )

    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1))
    expect(record.mock.calls[0][0].details.gpuFallbackTier).toBe(2)
  })

  it('allows the same renderer crash to retry after persistence fails', async () => {
    const record = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValueOnce({ id: 'report-2' })
    const dedupe = new ProcessGoneDedupe()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    recordProcessGoneCrash({ record } as never, event(), dedupe)
    await vi.waitFor(() =>
      expect(getCrashBreadcrumbSnapshot()).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'crash_report_persist_failed' })])
      )
    )
    recordProcessGoneCrash({ record } as never, event(), dedupe)

    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(2))
  })
})
