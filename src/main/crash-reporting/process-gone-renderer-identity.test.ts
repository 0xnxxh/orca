import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { appMetricsMock } = vi.hoisted(() => ({
  appMetricsMock: vi.fn((): unknown[] => [])
}))

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.2.3-test',
    getAppMetrics: appMetricsMock
  }
}))

import { clearCrashBreadcrumbsForTest, getCrashBreadcrumbSnapshot } from './crash-breadcrumb-store'
import { getProcessGoneDedupeKey, ProcessGoneDedupe } from './process-gone-dedupe'
import { recordProcessGoneCrash, type ProcessGoneCrashEvent } from './process-gone-recorder'
import { _resetTracerForTests, setActiveSink, type TracerSink } from '../observability/tracer'

type CapturingSink = TracerSink & { records: unknown[]; flushMock: ReturnType<typeof vi.fn> }

/** Keeps tests off the real Crashpad directory; minidump pairing has its own suite. */
const noMinidump = async () => null
const attachDetails = async () => null

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

function rendererGone(overrides: Partial<ProcessGoneCrashEvent> = {}): ProcessGoneCrashEvent {
  return {
    source: 'renderer',
    processType: 'renderer',
    reason: 'killed',
    exitCode: 1,
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
})

afterEach(() => {
  vi.restoreAllMocks()
  _resetTracerForTests()
  clearCrashBreadcrumbsForTest()
})

describe('renderer process identity in process-gone dedupe', () => {
  // Field measurement (#15052): main window and a browser guest were killed
  // 248ms apart on Windows with identical reason/exitCode — 2 deaths, 1 report.
  it('records one report per renderer when two renderers die concurrently', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report-1' })
    const dedupe = new ProcessGoneDedupe()

    recordProcessGoneCrash(
      { record, attachDetails } as never,
      rendererGone({ webContentsId: 1 }),
      dedupe,
      noMinidump
    )
    recordProcessGoneCrash(
      { record, attachDetails } as never,
      rendererGone({ webContentsId: 42 }),
      dedupe,
      noMinidump
    )

    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(2))
    // Why: the span is what makes each death countable in diagnostics bundles.
    expect(sink.records).toEqual([
      expect.objectContaining({
        name: 'electron.process_gone',
        attributes: expect.objectContaining({ 'crash.web_contents_id': 1 })
      }),
      expect.objectContaining({
        name: 'electron.process_gone',
        attributes: expect.objectContaining({ 'crash.web_contents_id': 42 })
      })
    ])
  })

  it('still coalesces one renderer death surfacing under multiple reasons', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report-1' })
    const dedupe = new ProcessGoneDedupe()

    recordProcessGoneCrash(
      { record, attachDetails } as never,
      rendererGone({ reason: 'crashed', exitCode: -36861, webContentsId: 7 }),
      dedupe,
      noMinidump
    )
    recordProcessGoneCrash(
      { record, attachDetails } as never,
      rendererGone({ reason: 'oom', exitCode: -536870904, webContentsId: 7 }),
      dedupe,
      noMinidump
    )

    await vi.waitFor(() => expect(record).toHaveBeenCalledOnce())
  })

  it('leaves an auditable breadcrumb when the dedupe window drops an event', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report-1' })
    const dedupe = new ProcessGoneDedupe()

    recordProcessGoneCrash(
      { record, attachDetails } as never,
      rendererGone({ reason: 'crashed', exitCode: 5, webContentsId: 7 }),
      dedupe,
      noMinidump
    )
    recordProcessGoneCrash(
      { record, attachDetails } as never,
      rendererGone({ reason: 'oom', exitCode: -536870904, webContentsId: 7 }),
      dedupe,
      noMinidump
    )

    await vi.waitFor(() => expect(record).toHaveBeenCalledOnce())
    expect(getCrashBreadcrumbSnapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'process_gone_deduped',
          data: expect.objectContaining({ reason: 'oom', webContentsId: 7 })
        })
      ])
    )
  })

  it('coalesces the dedupe-drop breadcrumb so a burst cannot flood the ring', async () => {
    const record = vi.fn().mockResolvedValue({ id: 'report-1' })
    const dedupe = new ProcessGoneDedupe()

    recordProcessGoneCrash(
      { record, attachDetails } as never,
      rendererGone({ reason: 'crashed', exitCode: 5, webContentsId: 7 }),
      dedupe,
      noMinidump
    )
    for (let i = 0; i < 40; i++) {
      recordProcessGoneCrash(
        { record, attachDetails } as never,
        rendererGone({ reason: 'crashed', exitCode: 5, webContentsId: 7 }),
        dedupe,
        noMinidump
      )
    }

    await vi.waitFor(() => expect(record).toHaveBeenCalledOnce())
    const dropBreadcrumbs = getCrashBreadcrumbSnapshot().filter(
      (breadcrumb) => breadcrumb.name === 'process_gone_deduped'
    )
    expect(dropBreadcrumbs).toHaveLength(1)
  })
})

describe('getProcessGoneDedupeKey renderer identity', () => {
  it('keys distinct renderers apart while coalescing reasons per renderer', () => {
    const mainWindowCrashed = getProcessGoneDedupeKey('renderer', 'renderer', 'crashed', 5, 1)
    const mainWindowOom = getProcessGoneDedupeKey('renderer', 'renderer', 'oom', -536870904, 1)
    const guestCrashed = getProcessGoneDedupeKey('renderer', 'renderer', 'crashed', 5, 42)

    expect(mainWindowOom).toBe(mainWindowCrashed)
    expect(guestCrashed).not.toBe(mainWindowCrashed)
  })

  it('keeps child keys unchanged by renderer identity', () => {
    expect(getProcessGoneDedupeKey('child', 'Utility', 'crashed', 1)).toBe(
      'child:Utility:crashed:1'
    )
  })
})
