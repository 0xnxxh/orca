import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPaneInternal } from './pane-manager-types'
import {
  clearRetainedWebglPanesForTests,
  releaseRetainedWebglPane,
  RETAINED_WEBGL_PANE_LIMIT,
  retainedWebglPaneCount,
  retainSuspendedWebglPane,
  shouldRetainSuspendedWebglContexts
} from './pane-webgl-context-retention'
import { resumePaneRendering, suspendPaneRendering } from './pane-rendering-control'
import { disposeWebgl } from './pane-webgl-renderer'

function createAttachedPane(id: number): ManagedPaneInternal {
  return {
    id,
    webglAddon: { dispose: vi.fn() },
    webglAttachmentDeferred: false,
    pendingWebglRefreshRafId: null
  } as never
}

function stubRendererWindow(platform: NodeJS.Platform, webClient = false): void {
  vi.stubGlobal('window', {
    __ORCA_WEB_CLIENT__: webClient,
    api: { platform: { get: () => ({ platform }) } },
    location: { pathname: webClient ? '/web-index.html' : '/index.html' }
  })
}

describe('pane WebGL context retention', () => {
  afterEach(() => {
    clearRetainedWebglPanesForTests()
    vi.unstubAllGlobals()
  })

  it('retains contexts only on Windows desktop', () => {
    stubRendererWindow('win32')
    expect(shouldRetainSuspendedWebglContexts()).toBe(true)

    stubRendererWindow('darwin')
    expect(shouldRetainSuspendedWebglContexts()).toBe(false)

    stubRendererWindow('linux')
    expect(shouldRetainSuspendedWebglContexts()).toBe(false)

    stubRendererWindow('win32', true)
    expect(shouldRetainSuspendedWebglContexts()).toBe(false)
  })

  it('recognizes a web client from its entrypoint', () => {
    vi.stubGlobal('window', {
      api: { platform: { get: () => ({ platform: 'win32' }) } },
      location: { pathname: '/web-index.html' }
    })

    expect(shouldRetainSuspendedWebglContexts()).toBe(false)
  })

  it('evicts and disposes the oldest hidden contexts past the limit', () => {
    stubRendererWindow('win32')
    const panes = Array.from({ length: RETAINED_WEBGL_PANE_LIMIT + 2 }, (_, index) =>
      createAttachedPane(index)
    )
    const oldestAddon = panes[0].webglAddon

    suspendPaneRendering(panes)

    expect(retainedWebglPaneCount()).toBe(RETAINED_WEBGL_PANE_LIMIT)
    expect(oldestAddon?.dispose).toHaveBeenCalledTimes(1)
    expect(panes[0].webglAddon).toBeNull()
    expect(panes[1].webglAddon).toBeNull()
    expect(panes[2].webglAddon).not.toBeNull()
    expect(panes.at(-1)?.webglAddon).not.toBeNull()

    disposeWebgl(panes[0])
    expect(oldestAddon?.dispose).toHaveBeenCalledTimes(1)
  })

  it('moves a re-retained pane to the newest position', () => {
    const panes = Array.from({ length: RETAINED_WEBGL_PANE_LIMIT + 1 }, (_, index) =>
      createAttachedPane(index)
    )
    for (const pane of panes.slice(0, RETAINED_WEBGL_PANE_LIMIT)) {
      retainSuspendedWebglPane(pane)
    }

    retainSuspendedWebglPane(panes[0])
    const evicted = retainSuspendedWebglPane(panes.at(-1)!)

    expect(evicted).toBe(panes[1])
    expect(retainedWebglPaneCount()).toBe(RETAINED_WEBGL_PANE_LIMIT)
  })

  it('evicts across pane managers using global worktree hide recency', () => {
    stubRendererWindow('win32')
    const firstManagerPanes = Array.from({ length: RETAINED_WEBGL_PANE_LIMIT }, (_, index) =>
      createAttachedPane(index)
    )
    const secondManagerPane = createAttachedPane(RETAINED_WEBGL_PANE_LIMIT)

    suspendPaneRendering(firstManagerPanes)
    suspendPaneRendering([secondManagerPane])

    expect(firstManagerPanes[0].webglAddon).toBeNull()
    expect(secondManagerPane.webglAddon).not.toBeNull()
    expect(retainedWebglPaneCount()).toBe(RETAINED_WEBGL_PANE_LIMIT)
  })

  it('releases panes from the retained set', () => {
    const pane = createAttachedPane(1)
    retainSuspendedWebglPane(pane)

    releaseRetainedWebglPane(pane)

    expect(retainedWebglPaneCount()).toBe(0)
  })

  it('never leaves resumed panes eligible for eviction', () => {
    stubRendererWindow('win32')
    const pane = createAttachedPane(1)
    pane.webglAttachmentDeferred = true
    retainSuspendedWebglPane(pane)

    resumePaneRendering([pane])

    expect(retainedWebglPaneCount()).toBe(0)
    expect(pane.webglAddon).not.toBeNull()
  })
})
