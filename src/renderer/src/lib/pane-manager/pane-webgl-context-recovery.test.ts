import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setTerminalWebglDiagnosticRecorder } from '../../../../shared/terminal-webgl-diagnostics'
import type { ManagedPaneInternal } from './pane-manager-types'
import { resumePaneRendering, suspendPaneRendering } from './pane-rendering-control'
import {
  clearRetainedWebglPanesForTests,
  RETAINED_WEBGL_PANE_LIMIT,
  retainedWebglPaneCount
} from './pane-webgl-context-retention'
import { rebuildAttachedWebgl } from './pane-webgl-reattach'
import { attachWebgl, resetTerminalWebglSuggestion } from './pane-webgl-renderer'

function createPane(options: { id?: number; loadAddon?: () => void } = {}): ManagedPaneInternal {
  const leafId = '11111111-1111-4111-8111-111111111111' as never
  return {
    id: options.id ?? 1,
    leafId,
    stablePaneId: leafId,
    terminal: {
      cols: 80,
      rows: 24,
      refresh: vi.fn(),
      loadAddon: vi.fn(options.loadAddon)
    } as never,
    container: {} as never,
    xtermContainer: {} as never,
    linkTooltip: {} as never,
    terminalGpuAcceleration: 'on',
    gpuRenderingEnabled: true,
    webglAttachmentDeferred: false,
    webglDisabledAfterContextLoss: false,
    hasComplexScriptOutput: false,
    webglAddon: null,
    ligaturesAddon: null,
    fitResizeObserver: null,
    pendingObservedFitRafId: null,
    pendingWebglRefreshRafId: null,
    fitAddon: {
      proposeDimensions: vi.fn(() => ({ cols: 80, rows: 23 })),
      fit: vi.fn()
    } as never,
    searchAddon: {} as never,
    serializeAddon: {} as never,
    unicode11Addon: {} as never,
    webLinksAddon: {} as never,
    compositionHandler: null,
    pendingSplitScrollState: null,
    debugLabel: null
  }
}

function throwWebglUnavailable(): never {
  // Mirrors the addon's activate() throw when getContext('webgl2') returns null.
  throw new Error('WebGL2 not supported null')
}

function fireContextLoss(pane: ManagedPaneInternal): void {
  // Fire the addon's real context-loss emitter so the loss -> latch -> resume
  // cycle runs through the production onContextLoss handler.
  const addon = pane.webglAddon as unknown as { _onContextLoss: { fire: () => void } }
  addon._onContextLoss.fire()
}

function stubWindowsDesktop(): void {
  vi.stubGlobal('window', {
    api: { platform: { get: () => ({ platform: 'win32' }) } },
    location: { pathname: '/index.html' }
  })
}

describe('terminal WebGL context recovery', () => {
  beforeEach(() => {
    resetTerminalWebglSuggestion()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(16)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    clearRetainedWebglPanesForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('backs off after a failed attach instead of retrying on every call', () => {
    const pane = createPane({ loadAddon: throwWebglUnavailable })

    attachWebgl(pane)
    expect(pane.terminal.loadAddon).toHaveBeenCalledTimes(1)
    expect(pane.webglAddon).toBeNull()

    // Title changes re-enter attach via setPaneGpuRendering; while WebGL is
    // blocked these must not construct new addons or log again.
    attachWebgl(pane)
    attachWebgl(pane)
    expect(pane.terminal.loadAddon).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('retries a backed-off attach on the next rendering resume', () => {
    const pane = createPane({ loadAddon: throwWebglUnavailable })

    attachWebgl(pane)
    attachWebgl(pane)
    expect(pane.terminal.loadAddon).toHaveBeenCalledTimes(1)

    resumePaneRendering([pane])
    expect(pane.terminal.loadAddon).toHaveBeenCalledTimes(2)
  })

  it('recovers a context-lost pane on the next rendering resume', () => {
    const pane = createPane()

    attachWebgl(pane)
    expect(pane.webglAddon).not.toBeNull()

    fireContextLoss(pane)
    expect(pane.webglDisabledAfterContextLoss).toBe(true)
    expect(pane.webglAddon).toBeNull()

    resumePaneRendering([pane])
    expect(pane.webglDisabledAfterContextLoss).toBe(false)
    expect(pane.webglAddon).not.toBeNull()
  })

  it('reuses a retained Windows context without loading another addon', () => {
    stubWindowsDesktop()
    const pane = createPane()
    attachWebgl(pane)
    const addon = pane.webglAddon
    vi.mocked(pane.terminal.refresh).mockClear()

    suspendPaneRendering([pane])
    resumePaneRendering([pane])

    expect(pane.webglAddon).toBe(addon)
    expect(pane.terminal.loadAddon).toHaveBeenCalledTimes(1)
    expect(pane.terminal.refresh).toHaveBeenCalledWith(0, 23)
  })

  it('keeps a healthy visible context on window wake', () => {
    const pane = createPane()
    attachWebgl(pane)
    const addon = pane.webglAddon

    resumePaneRendering([pane])

    expect(pane.webglAddon).toBe(addon)
    expect(pane.terminal.loadAddon).toHaveBeenCalledTimes(1)
  })

  it('replaces a synchronously lost visible context on window wake', () => {
    const pane = createPane()
    const dispose = vi.fn()
    pane.webglAddon = {
      dispose,
      _renderer: {
        _gl: {
          getExtension: vi.fn(() => null),
          isContextLost: vi.fn(() => true)
        }
      }
    } as never

    resumePaneRendering([pane])

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(pane.webglAddon).not.toBeNull()
    expect(pane.terminal.loadAddon).toHaveBeenCalledTimes(1)
  })

  it('replaces a retained context lost before xterm fires its delayed event', () => {
    stubWindowsDesktop()
    const pane = createPane()
    const dispose = vi.fn()
    pane.webglAddon = {
      dispose,
      _renderer: {
        _gl: {
          getExtension: vi.fn(() => null),
          isContextLost: vi.fn(() => true)
        }
      }
    } as never

    suspendPaneRendering([pane])
    resumePaneRendering([pane])

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(pane.webglAddon).not.toBeNull()
    expect(pane.terminal.loadAddon).toHaveBeenCalledTimes(1)
  })

  it('defers requested WebGL rebuilds until a hidden pane resumes', () => {
    stubWindowsDesktop()
    const pane = createPane()
    attachWebgl(pane)
    const retainedAddon = pane.webglAddon
    suspendPaneRendering([pane])

    rebuildAttachedWebgl(pane)

    expect(pane.webglAddon).toBe(retainedAddon)
    expect(pane.webglRebuildDeferred).toBe(true)
    expect(pane.terminal.loadAddon).toHaveBeenCalledTimes(1)

    resumePaneRendering([pane])

    expect(pane.webglAddon).not.toBe(retainedAddon)
    expect(pane.webglRebuildDeferred).toBe(false)
    expect(pane.terminal.loadAddon).toHaveBeenCalledTimes(2)
  })

  it('reattaches an LRU-evicted context when its pane resumes', () => {
    stubWindowsDesktop()
    const panes = Array.from({ length: RETAINED_WEBGL_PANE_LIMIT + 1 }, (_, id) =>
      createPane({ id })
    )
    for (const pane of panes) {
      attachWebgl(pane)
    }

    suspendPaneRendering(panes)
    expect(panes[0].webglAddon).toBeNull()
    expect(panes[0].terminal.loadAddon).toHaveBeenCalledTimes(1)

    resumePaneRendering(panes)

    expect(retainedWebglPaneCount()).toBe(0)
    expect(panes[0].webglAddon).not.toBeNull()
    expect(panes[0].terminal.loadAddon).toHaveBeenCalledTimes(2)
    expect(panes[1].terminal.loadAddon).toHaveBeenCalledTimes(1)
  })

  it('blocks new WebGL contexts while a Windows pane is hidden', () => {
    stubWindowsDesktop()
    const pane = createPane()

    suspendPaneRendering([pane])
    attachWebgl(pane)

    expect(pane.webglAddon).toBeNull()
    expect(pane.terminal.loadAddon).not.toHaveBeenCalled()
  })

  it('recovers a retained Windows context lost while hidden', () => {
    stubWindowsDesktop()
    const pane = createPane()
    attachWebgl(pane)
    suspendPaneRendering([pane])
    expect(retainedWebglPaneCount()).toBe(1)

    fireContextLoss(pane)

    expect(pane.webglAddon).toBeNull()
    expect(pane.webglDisabledAfterContextLoss).toBe(true)
    expect(retainedWebglPaneCount()).toBe(0)

    resumePaneRendering([pane])

    expect(pane.webglDisabledAfterContextLoss).toBe(false)
    expect(pane.webglAddon).not.toBeNull()
    expect(pane.terminal.loadAddon).toHaveBeenCalledTimes(2)
  })

  it('does not schedule a DOM refit when a hidden retained context is lost', () => {
    stubWindowsDesktop()
    const requestAnimationFrame = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)
    const pane = createPane()
    attachWebgl(pane)
    suspendPaneRendering([pane])

    fireContextLoss(pane)

    expect(requestAnimationFrame).not.toHaveBeenCalled()
    expect(pane.pendingWebglRefreshRafId).toBeNull()
  })

  it('re-latches when the retried context is lost again', () => {
    const pane = createPane()

    attachWebgl(pane)
    fireContextLoss(pane)
    resumePaneRendering([pane])
    expect(pane.webglAddon).not.toBeNull()

    fireContextLoss(pane)
    expect(pane.webglDisabledAfterContextLoss).toBe(true)
    expect(pane.webglAddon).toBeNull()
  })

  // Why exact keys: a GPU death loses every pane's context at once and the
  // crash ring coalesces the repeats, so the population has to survive on the
  // payload. It must use the same names the fit-retry crumb uses, or one ring
  // ends up describing one measurement two ways.
  it('carries the pane census under the same field names the fit-retry crumb uses', () => {
    const recorded: { kind: string; detail?: Record<string, unknown> }[] = []
    setTerminalWebglDiagnosticRecorder((kind, detail) => recorded.push({ kind, detail }))
    try {
      const pane = createPane()
      attachWebgl(pane)
      fireContextLoss(pane)
    } finally {
      setTerminalWebglDiagnosticRecorder(null)
    }

    expect(recorded).toEqual([
      {
        kind: 'webgl-context-loss',
        detail: { paneId: 1, livePanes: expect.any(Number), livePaneManagers: expect.any(Number) }
      }
    ])
  })
})
