import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CrashDiagnostics from './crash-diagnostics'

type DiagnosticsModule = typeof CrashDiagnostics
type Listener = (event: unknown) => void

describe('renderer crash diagnostics', () => {
  let diagnostics: DiagnosticsModule
  let listeners: Map<string, Listener[]>
  let recordBreadcrumbMock: ReturnType<typeof vi.fn>
  let setIntervalMock: ReturnType<typeof vi.fn>
  let clearIntervalMock: ReturnType<typeof vi.fn>
  let removeEventListenerMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    listeners = new Map()
    recordBreadcrumbMock = vi.fn()
    setIntervalMock = vi.fn(() => 1)
    clearIntervalMock = vi.fn()
    removeEventListenerMock = vi.fn((type: string, listener: Listener) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((candidate) => candidate !== listener)
      )
    })
    vi.stubGlobal('window', {
      api: {
        crashReports: {
          recordBreadcrumb: recordBreadcrumbMock
        }
      },
      addEventListener: vi.fn((type: string, listener: Listener) => {
        const current = listeners.get(type) ?? []
        current.push(listener)
        listeners.set(type, current)
      }),
      removeEventListener: removeEventListenerMock,
      setInterval: setIntervalMock,
      clearInterval: clearIntervalMock,
      performance: {
        memory: {
          usedJSHeapSize: 32 * 1024 * 1024,
          totalJSHeapSize: 64 * 1024 * 1024,
          jsHeapSizeLimit: 512 * 1024 * 1024
        }
      }
    })
    vi.doMock('../components/browser-pane/webview-registry', () => ({
      getBrowserWebviewMemoryProfile: () => ({
        browserWebviewCount: 4,
        registeredBrowserGuestCount: 3
      })
    }))
    diagnostics = (await import('./crash-diagnostics')) as DiagnosticsModule
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('records renderer breadcrumbs through preload', () => {
    diagnostics.recordRendererCrashBreadcrumb('renderer_bootstrap_started', { dev: true })

    expect(recordBreadcrumbMock).toHaveBeenCalledWith({
      name: 'renderer_bootstrap_started',
      data: { dev: true }
    })
  })

  it('installs startup, error, rejection, and memory breadcrumbs once', () => {
    diagnostics.installRendererCrashDiagnostics()
    diagnostics.installRendererCrashDiagnostics()

    expect(window.addEventListener).toHaveBeenCalledTimes(2)
    expect(setIntervalMock).toHaveBeenCalledTimes(1)
    expect(recordBreadcrumbMock).toHaveBeenCalledWith({
      name: 'renderer_memory',
      data: {
        reason: 'startup',
        usedHeapMB: 32,
        totalHeapMB: 64,
        heapLimitMB: 512,
        // Why: without this tag a reader cannot tell an exact heap number from a
        // Blink-quantized one, which is what made earlier bundles unanalyzable.
        heapSource: 'quantized',
        browserWebviews: 4,
        registeredBrowserGuests: 3
      }
    })

    listeners.get('error')?.[0]?.({
      message: 'boom',
      filename: '/Users/test/project/src/main.tsx',
      lineno: 42,
      colno: 7,
      error: new TypeError('bad renderer state')
    })
    expect(recordBreadcrumbMock).toHaveBeenCalledWith({
      name: 'renderer_error',
      data: expect.objectContaining({
        message: 'boom',
        filename: '/Users/test/project/src/main.tsx',
        lineno: 42,
        colno: 7,
        errorType: 'TypeError',
        errorName: 'TypeError',
        errorMessage: 'bad renderer state'
      })
    })

    listeners.get('unhandledrejection')?.[0]?.({ reason: 'missing startup dependency' })
    expect(recordBreadcrumbMock).toHaveBeenCalledWith({
      name: 'renderer_unhandled_rejection',
      data: {
        reasonType: 'string',
        reasonMessage: 'missing startup dependency'
      }
    })
  })

  it('suppresses benign ResizeObserver loop errors instead of recording them', () => {
    diagnostics.installRendererCrashDiagnostics()
    recordBreadcrumbMock.mockClear()

    const preventDefault = vi.fn()
    listeners.get('error')?.[0]?.({
      message: 'ResizeObserver loop completed with undelivered notifications.',
      preventDefault
    })
    listeners.get('error')?.[0]?.({
      message: 'ResizeObserver loop limit exceeded',
      preventDefault
    })

    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(recordBreadcrumbMock).not.toHaveBeenCalled()
  })

  it('records application errors that only mention a ResizeObserver loop', () => {
    diagnostics.installRendererCrashDiagnostics()
    recordBreadcrumbMock.mockClear()

    const preventDefault = vi.fn()
    listeners.get('error')?.[0]?.({
      message: 'ResizeObserver loop failed while rendering the terminal',
      preventDefault
    })

    expect(preventDefault).not.toHaveBeenCalled()
    expect(recordBreadcrumbMock).toHaveBeenCalledWith({
      name: 'renderer_error',
      data: expect.objectContaining({
        message: 'ResizeObserver loop failed while rendering the terminal'
      })
    })
  })

  it('does not throw when preload is unavailable', () => {
    vi.stubGlobal('window', {})

    expect(() =>
      diagnostics.recordRendererCrashBreadcrumb('renderer_bootstrap_started')
    ).not.toThrow()
  })

  it('profiles subsystems every highwater and caps DOM census to 60%/75%', async () => {
    const memory = (window.performance as unknown as { memory: Record<string, number> }).memory
    memory.usedJSHeapSize = 0.45 * memory.jsHeapSizeLimit
    const getElementsByTagName = vi.fn(() => ({ length: 4321 }))
    const querySelectorAll = vi.fn(() => ({ length: 6 }))
    vi.stubGlobal('document', {
      getElementsByTagName,
      querySelectorAll
    })
    const profile = await import('./renderer-memory-profile')
    let unregister = profile.registerRendererMemoryProfileContributor('store', () => ({
      worktrees: 12
    }))

    diagnostics.installRendererCrashDiagnostics()
    const highwaterCalls = (): unknown[] =>
      recordBreadcrumbMock.mock.calls.filter(
        (call) => (call[0] as { name: string }).name === 'renderer_memory_highwater'
      )
    // Why: 40% is a new ladder rung — subsystem census only, no full DOM walk.
    expect(highwaterCalls()).toHaveLength(1)
    expect(getElementsByTagName).not.toHaveBeenCalled()
    expect(querySelectorAll).not.toHaveBeenCalled()
    expect(recordBreadcrumbMock).toHaveBeenCalledWith({
      name: 'renderer_memory_highwater',
      data: expect.objectContaining({
        thresholdPct: 40,
        rendererSurface: 'main',
        browserWebviews: 4,
        registeredBrowserGuests: 3,
        'store.worktrees': 12
      })
    })
    expect(recordBreadcrumbMock).toHaveBeenCalledWith({
      name: 'renderer_memory_highwater',
      data: expect.not.objectContaining({
        domNodes: expect.anything(),
        terminalElements: expect.anything()
      })
    })

    const tick = setIntervalMock.mock.calls[0][0] as () => void
    memory.usedJSHeapSize = 0.7 * memory.jsHeapSizeLimit
    tick()
    // Why 2 total: 40 already emitted; 60 is the first DOM checkpoint.
    expect(highwaterCalls()).toHaveLength(2)
    expect(getElementsByTagName).toHaveBeenCalledTimes(1)
    expect(querySelectorAll).toHaveBeenCalledTimes(1)
    expect(recordBreadcrumbMock).toHaveBeenCalledWith({
      name: 'renderer_memory_highwater',
      data: expect.objectContaining({
        thresholdPct: 60,
        domNodes: 4321,
        terminalElements: 6,
        'store.worktrees': 12
      })
    })

    // Why: the interval sampler must not re-emit an already-crossed threshold.
    tick()
    expect(highwaterCalls()).toHaveLength(2)

    memory.usedJSHeapSize = 0.86 * memory.jsHeapSizeLimit
    tick()
    expect(highwaterCalls()).toHaveLength(4)
    // Why: second (and last) DOM shot is 75%; 85 reuses that sample's snapshot.
    expect(getElementsByTagName).toHaveBeenCalledTimes(2)
    expect(querySelectorAll).toHaveBeenCalledTimes(2)
    expect(recordBreadcrumbMock).toHaveBeenCalledWith({
      name: 'renderer_memory_highwater',
      data: expect.objectContaining({
        thresholdPct: 75,
        domNodes: 4321,
        'store.worktrees': 12
      })
    })
    expect(recordBreadcrumbMock).toHaveBeenCalledWith({
      name: 'renderer_memory_highwater',
      data: expect.objectContaining({
        thresholdPct: 85,
        domNodes: 4321,
        'store.worktrees': 12
      })
    })

    // Why: a jump past every rung still profiles subsystems once and DOM once
    // (60 and 75 are among the newly crossed set).
    unregister()
    vi.resetModules()
    recordBreadcrumbMock.mockClear()
    getElementsByTagName.mockClear()
    querySelectorAll.mockClear()
    const resetProfile = await import('./renderer-memory-profile')
    unregister = resetProfile.registerRendererMemoryProfileContributor('store', () => ({
      worktrees: 12
    }))
    diagnostics = (await import('./crash-diagnostics')) as DiagnosticsModule
    diagnostics.installRendererCrashDiagnostics()
    expect(highwaterCalls()).toHaveLength(4)
    expect(getElementsByTagName).toHaveBeenCalledTimes(1)
    expect(querySelectorAll).toHaveBeenCalledTimes(1)
    expect(recordBreadcrumbMock).toHaveBeenCalledWith({
      name: 'renderer_memory_highwater',
      data: expect.objectContaining({
        thresholdPct: 40,
        domNodes: 4321,
        'store.worktrees': 12
      })
    })

    unregister()
  })

  it('skips highwater emission when heap readings are not finite', () => {
    const memory = (window.performance as unknown as { memory: Record<string, number> }).memory
    memory.usedJSHeapSize = Number.NaN

    diagnostics.installRendererCrashDiagnostics()

    expect(
      recordBreadcrumbMock.mock.calls.some(
        (call) => (call[0] as { name: string }).name === 'renderer_memory_highwater'
      )
    ).toBe(false)
  })

  describe('exact V8 heap statistics', () => {
    const KB = 1024
    let readHeapStatistics: ReturnType<typeof vi.fn>

    const stubHeap = (usedMB: number, limitMB = 512): void => {
      readHeapStatistics.mockReturnValue({
        usedHeapKB: usedMB * KB,
        totalHeapKB: usedMB * KB * 2,
        heapLimitKB: limitMB * KB,
        mallocedKB: 3 * KB,
        blinkAllocatedKB: 7 * KB
      })
    }

    beforeEach(() => {
      readHeapStatistics = vi.fn()
      ;(window.api.crashReports as unknown as { readHeapStatistics: unknown }).readHeapStatistics =
        readHeapStatistics
    })

    it('prefers exact statistics over performance.memory and labels the source', () => {
      stubHeap(101)

      diagnostics.installRendererCrashDiagnostics()

      // Why: performance.memory still says 32MB here. Reporting 101 proves the
      // exact reading wins rather than merely being recorded alongside.
      expect(recordBreadcrumbMock).toHaveBeenCalledWith({
        name: 'renderer_memory',
        data: expect.objectContaining({
          usedHeapMB: 101,
          heapLimitMB: 512,
          heapSource: 'v8',
          mallocedMB: 3,
          blinkAllocatedMB: 7
        })
      })
    })

    it('observes growth that performance.memory quantizes away', () => {
      // Why: this is the whole point. Blink pins usedJSHeapSize to a bucket and
      // caches it ~20min, so a real climb reports byte-identical values and a
      // highwater threshold never fires. Exact stats must still cross it.
      const quantized = (window.performance as unknown as { memory: Record<string, number> }).memory
      quantized.usedJSHeapSize = 32 * 1024 * 1024
      stubHeap(100)
      vi.stubGlobal('document', {
        getElementsByTagName: () => ({ length: 1 }),
        querySelectorAll: () => ({ length: 0 })
      })

      diagnostics.installRendererCrashDiagnostics()
      const highwaterCalls = (): unknown[] =>
        recordBreadcrumbMock.mock.calls.filter(
          (call) => (call[0] as { name: string }).name === 'renderer_memory_highwater'
        )
      expect(highwaterCalls()).toHaveLength(0)

      stubHeap(400) // 78% of 512 — past 40%, 60%, and 75%, still below 85%.
      const tick = setIntervalMock.mock.calls[0][0] as () => void
      tick()

      expect(quantized.usedJSHeapSize).toBe(32 * 1024 * 1024)
      expect(highwaterCalls()).toHaveLength(3)
      expect(recordBreadcrumbMock).toHaveBeenCalledWith({
        name: 'renderer_memory_highwater',
        data: expect.objectContaining({ thresholdPct: 75, usedHeapMB: 400, heapSource: 'v8' })
      })
    })

    it('omits the Blink field instead of emitting a junk value for it', () => {
      // Why: `undefined * 1024` is NaN. The breadcrumb must carry no
      // blinkAllocatedMB at all rather than a meaningless number.
      readHeapStatistics.mockReturnValue({
        usedHeapKB: 77 * KB,
        totalHeapKB: 154 * KB,
        heapLimitKB: 512 * KB,
        mallocedKB: 3 * KB,
        blinkAllocatedKB: undefined
      })

      diagnostics.installRendererCrashDiagnostics()

      const call = recordBreadcrumbMock.mock.calls.find(
        ([entry]) => (entry as { name: string }).name === 'renderer_memory'
      )?.[0] as { data: Record<string, unknown> }
      expect(call.data).toMatchObject({ usedHeapMB: 77, heapSource: 'v8', mallocedMB: 3 })
      expect(call.data).not.toHaveProperty('blinkAllocatedMB')
    })

    it('falls back to performance.memory when the bridge returns null', () => {
      readHeapStatistics.mockReturnValue(null)

      diagnostics.installRendererCrashDiagnostics()

      expect(recordBreadcrumbMock).toHaveBeenCalledWith({
        name: 'renderer_memory',
        data: expect.objectContaining({ usedHeapMB: 32, heapSource: 'quantized' })
      })
    })

    it('samples on an older shell whose preload lacks the bridge', () => {
      ;(window.api.crashReports as unknown as Record<string, unknown>).readHeapStatistics =
        undefined

      expect(() => diagnostics.installRendererCrashDiagnostics()).not.toThrow()
      expect(recordBreadcrumbMock).toHaveBeenCalledWith({
        name: 'renderer_memory',
        data: expect.objectContaining({ usedHeapMB: 32, heapSource: 'quantized' })
      })
    })
  })
})
