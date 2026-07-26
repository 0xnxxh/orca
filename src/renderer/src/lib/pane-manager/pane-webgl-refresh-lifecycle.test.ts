import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaneManager } from './pane-manager'
import type { ManagedPaneInternal } from './pane-manager-types'
import { disposePane } from './pane-lifecycle'
import { resumePaneRendering, suspendPaneRendering } from './pane-rendering-control'
import {
  clearRetainedWebglPanesForTests,
  retainedWebglPaneCount
} from './pane-webgl-context-retention'
import { disposeWebgl } from './pane-webgl-renderer'
import {
  beginTerminalScrollIntentBufferRebuild,
  endTerminalScrollIntentBufferRebuild
} from './terminal-scroll-intent-rebuild'

function createPane(
  overrides: Partial<
    Pick<ManagedPaneInternal, 'id' | 'pendingWebglRefreshRafId' | 'webglAddon'>
  > = {}
): ManagedPaneInternal {
  const leafId = '11111111-1111-4111-8111-111111111111' as never
  return {
    id: 1,
    leafId,
    stablePaneId: leafId,
    terminal: {
      element: null,
      cols: 80,
      rows: 24,
      buffer: { active: { type: 'normal', viewportY: 0, baseY: 0 } },
      refresh: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn()
    } as never,
    container: {
      dataset: {},
      getBoundingClientRect: () => ({ width: 800, height: 600 })
    } as never,
    xtermContainer: {} as never,
    linkTooltip: {} as never,
    terminalGpuAcceleration: 'off',
    gpuRenderingEnabled: false,
    webglAttachmentDeferred: false,
    webglDisabledAfterContextLoss: false,
    hasComplexScriptOutput: false,
    fitAddon: {
      fit: vi.fn(),
      proposeDimensions: vi.fn(() => ({ cols: 100, rows: 24 })),
      dispose: vi.fn()
    } as never,
    fitResizeObserver: null,
    pendingInitialFitRafId: null,
    pendingWebglRefreshRafId: null,
    pendingObservedFitRafId: null,
    searchAddon: { dispose: vi.fn() } as never,
    serializeAddon: { dispose: vi.fn() } as never,
    unicode11Addon: { dispose: vi.fn() } as never,
    webLinksAddon: { dispose: vi.fn() } as never,
    webglAddon: { dispose: vi.fn() } as never,
    ligaturesAddon: null,
    compositionHandler: null,
    pendingSplitScrollState: null,
    pendingSplitScrollBufferDisposable: null,
    debugLabel: null,
    ...overrides
  }
}

function stubRendererWindow(platform: NodeJS.Platform, webClient = false): void {
  vi.stubGlobal('window', {
    __ORCA_WEB_CLIENT__: webClient,
    api: { platform: { get: () => ({ platform }) } },
    location: { pathname: webClient ? '/web-index.html' : '/index.html' }
  })
}

describe('pane WebGL refresh lifecycle', () => {
  afterEach(() => {
    clearRetainedWebglPanesForTests()
    vi.unstubAllGlobals()
  })

  it('tracks the deferred refresh frame after WebGL teardown', () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 29)
    )
    const pane = createPane()

    disposeWebgl(pane, { refreshDimensions: true })

    expect(pane.webglAddon).toBeNull()
    expect(pane.pendingWebglRefreshRafId).toBe(29)
  })

  it('defers the DOM-renderer refit until structural replay completes', async () => {
    const refreshFrame: { current: FrameRequestCallback | null } = { current: null }
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      refreshFrame.current = callback
      return 29
    })
    const pane = createPane()
    beginTerminalScrollIntentBufferRebuild(pane.terminal)

    disposeWebgl(pane, { refreshDimensions: true })
    refreshFrame.current?.(0)
    expect(pane.fitAddon.fit).not.toHaveBeenCalled()
    expect(pane.terminal.refresh).not.toHaveBeenCalled()

    endTerminalScrollIntentBufferRebuild(pane.terminal)
    await Promise.resolve()
    expect(pane.fitAddon.fit).toHaveBeenCalledTimes(1)
    expect(pane.terminal.refresh).toHaveBeenCalledTimes(1)
  })

  it('actively releases the xterm WebGL context before disposing the addon', () => {
    const loseContext = vi.fn()
    const canvas = { width: 120, height: 40 }
    const dispose = vi.fn()
    const pane = createPane({
      webglAddon: {
        dispose,
        _renderer: {
          _gl: {
            getExtension: vi.fn(() => ({ loseContext }))
          },
          _canvas: canvas
        }
      } as never
    })

    disposeWebgl(pane)

    expect(loseContext).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(canvas).toEqual({ width: 0, height: 0 })
    expect(pane.webglAddon).toBeNull()
  })

  it('disposes WebGL when rendering is suspended', () => {
    stubRendererWindow('darwin')
    const dispose = vi.fn()
    const pane = createPane({ webglAddon: { dispose } as never })

    suspendPaneRendering([pane])

    expect(pane.webglAttachmentDeferred).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(pane.webglAddon).toBeNull()
  })

  it('retains and reuses a live WebGL addon on Windows desktop', () => {
    stubRendererWindow('win32')
    const dispose = vi.fn()
    const addon = { dispose } as never
    const pane = createPane({ webglAddon: addon })
    vi.mocked(pane.terminal.refresh).mockClear()

    suspendPaneRendering([pane])

    expect(pane.webglAttachmentDeferred).toBe(true)
    expect(pane.webglAddon).toBe(addon)
    expect(dispose).not.toHaveBeenCalled()

    resumePaneRendering([pane])

    expect(pane.webglAttachmentDeferred).toBe(false)
    expect(pane.webglAddon).toBe(addon)
    expect(pane.terminal.refresh).toHaveBeenCalledWith(0, 23)
  })

  it('disposes suspended WebGL in a Windows web client', () => {
    stubRendererWindow('win32', true)
    const dispose = vi.fn()
    const pane = createPane({ webglAddon: { dispose } as never })

    suspendPaneRendering([pane])

    expect(pane.webglAttachmentDeferred).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(pane.webglAddon).toBeNull()
  })

  it('skips retained panes but refreshes hidden DOM panes during global recovery', () => {
    const retained = createPane({ id: 1 })
    const hiddenDom = createPane({ id: 2, webglAddon: null })
    const visible = createPane()
    retained.webglAttachmentDeferred = true
    hiddenDom.webglAttachmentDeferred = true
    vi.mocked(retained.terminal.refresh).mockClear()
    vi.mocked(hiddenDom.terminal.refresh).mockClear()
    vi.mocked(visible.terminal.refresh).mockClear()

    PaneManager.prototype.refreshAllPanes.call({
      panes: new Map([
        [1, retained],
        [2, hiddenDom],
        [3, visible]
      ])
    } as never)

    expect(retained.terminal.refresh).not.toHaveBeenCalled()
    expect(hiddenDom.terminal.refresh).toHaveBeenCalledWith(0, 23)
    expect(visible.terminal.refresh).toHaveBeenCalledWith(0, 23)
  })

  it('disposes a retained Windows context when its pane unmounts', () => {
    stubRendererWindow('win32')
    const dispose = vi.fn()
    const pane = createPane({ webglAddon: { dispose } as never })
    const panes = new Map([[pane.id, pane]])
    suspendPaneRendering([pane])
    expect(retainedWebglPaneCount()).toBe(1)

    disposePane(pane, panes)

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(pane.webglAddon).toBeNull()
    expect(panes.has(pane.id)).toBe(false)
    expect(retainedWebglPaneCount()).toBe(0)
  })

  it('drains all retained contexts when a pane manager is destroyed', () => {
    stubRendererWindow('win32')
    const first = createPane({ id: 1 })
    const second = createPane({ id: 2 })
    const panes = new Map([
      [first.id, first],
      [second.id, second]
    ])
    suspendPaneRendering(panes.values())
    const root = {
      innerHTML: 'mounted',
      querySelectorAll: vi.fn(() => [])
    }

    PaneManager.prototype.destroy.call({
      destroyed: false,
      panes,
      identities: { clear: vi.fn() },
      root,
      activePaneId: first.id,
      dragState: {
        dragSourcePaneId: null,
        dropOverlay: null,
        currentDropTarget: null,
        currentExternalDropTarget: null,
        cleanupActiveDrag: null
      },
      cancelPendingPaneReparentFrames: vi.fn()
    } as never)

    expect(retainedWebglPaneCount()).toBe(0)
    expect(panes.size).toBe(0)
    expect(root.innerHTML).toBe('')
  })

  it('cancels a pending WebGL refresh when the pane is disposed', () => {
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
    const pane = createPane({
      pendingWebglRefreshRafId: 31,
      webglAddon: null
    })
    const panes = new Map([[pane.id, pane]])

    disposePane(pane, panes)

    expect(cancelAnimationFrame).toHaveBeenCalledWith(31)
    expect(pane.pendingWebglRefreshRafId).toBeNull()
    expect(panes.has(pane.id)).toBe(false)
  })
})
