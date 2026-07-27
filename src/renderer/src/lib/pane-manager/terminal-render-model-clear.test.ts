import { describe, expect, it, vi } from 'vitest'
import { clearTerminalRenderModel } from './terminal-render-model-clear'
import { schedulePaneRevealPresent } from './pane-reveal-repaint'
import type { ManagedPaneInternal } from './pane-manager-types'

describe('clearTerminalRenderModel', () => {
  it('clears the render model through the render service', () => {
    const clear = vi.fn()
    expect(clearTerminalRenderModel({ _core: { _renderService: { clear } } })).toBe(true)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('degrades to a no-op when the render service is unavailable', () => {
    expect(clearTerminalRenderModel({})).toBe(false)
    expect(clearTerminalRenderModel({ _core: {} })).toBe(false)
    expect(clearTerminalRenderModel({ _core: { _renderService: {} } })).toBe(false)
    expect(clearTerminalRenderModel(null)).toBe(false)
    expect(clearTerminalRenderModel(undefined)).toBe(false)
  })

  it('reports failure instead of throwing when the pane was disposed mid-frame', () => {
    const clear = vi.fn(() => {
      throw new Error('disposed')
    })
    expect(clearTerminalRenderModel({ _core: { _renderService: { clear } } })).toBe(false)
  })
})

describe('schedulePaneRevealPresent repaints a stale canvas', () => {
  it('clears the model before refreshing, and leaves the shared atlas alone', () => {
    // Why this ordering matters: refresh() is diff-based, so a model still
    // holding the pre-hide cells makes it skip exactly the cells an occluded
    // canvas lost. Clearing first turns the refresh into a full repaint. The
    // atlas must NOT be cleared here — it is shared with every same-config
    // pane and wiping it re-arms xterm's page-merge garble race (#4480).
    const calls: string[] = []
    const clearTextureAtlas = vi.fn(() => calls.push('atlas'))
    const pane = {
      id: 1,
      gpuRenderingEnabled: true,
      webglDisabledAfterContextLoss: false,
      webglAttachmentDeferred: false,
      webglAddon: { clearTextureAtlas },
      terminal: {
        rows: 24,
        refresh: () => calls.push('refresh'),
        _core: { _renderService: { clear: () => calls.push('clear-model') } }
      }
    } as unknown as ManagedPaneInternal

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    try {
      schedulePaneRevealPresent(() => [pane])
    } finally {
      vi.unstubAllGlobals()
    }

    expect(calls).toEqual(['clear-model', 'refresh'])
    expect(
      clearTextureAtlas,
      'the shared glyph atlas must survive a refocus'
    ).not.toHaveBeenCalled()
  })
})
