import { describe, expect, it, vi } from 'vitest'
import type { ManagedPane } from './pane-manager-types'
import { repairPaneWebglCanvasDprMismatch } from './terminal-canvas-dpr-repair'

function makePane(args: {
  backingWidth: number
  cssWidth: number
  dpr: number
  connected?: boolean
  hasRenderer?: boolean
}): {
  pane: ManagedPane
  handleDevicePixelRatioChange: ReturnType<typeof vi.fn>
  handleResize: ReturnType<typeof vi.fn>
  refresh: ReturnType<typeof vi.fn>
} {
  const handleDevicePixelRatioChange = vi.fn()
  const handleResize = vi.fn()
  const refresh = vi.fn()
  const canvas = {
    width: args.backingWidth,
    isConnected: args.connected ?? true,
    ownerDocument: { defaultView: { devicePixelRatio: args.dpr } },
    getBoundingClientRect: () => ({ width: args.cssWidth, height: 600 })
  }
  const renderer =
    (args.hasRenderer ?? true)
      ? { _canvas: canvas, handleDevicePixelRatioChange, handleResize }
      : undefined
  const pane = {
    id: 1,
    terminal: {
      cols: 120,
      rows: 40,
      refresh,
      _core: { _renderService: { _renderer: { value: renderer } } }
    }
  } as unknown as ManagedPane
  return { pane, handleDevicePixelRatioChange, handleResize, refresh }
}

describe('repairPaneWebglCanvasDprMismatch', () => {
  it('repairs a stale dpr-2 backing composited on a dpr-1 display', () => {
    // The reproduced field bug: hidden-time display change leaves a 2160px
    // backing behind a 1080px css box at dpr 1 (half-size/smeared text).
    const { pane, handleDevicePixelRatioChange, handleResize, refresh } = makePane({
      backingWidth: 2160,
      cssWidth: 1080,
      dpr: 1
    })

    expect(repairPaneWebglCanvasDprMismatch(pane)).toBe(true)
    expect(handleDevicePixelRatioChange).toHaveBeenCalledTimes(1)
    expect(handleResize).toHaveBeenCalledWith(120, 40)
    expect(refresh).toHaveBeenCalledWith(0, 39)
    // Dpr refresh must precede the resize that rebuilds the backing store.
    expect(handleDevicePixelRatioChange.mock.invocationCallOrder[0]!).toBeLessThan(
      handleResize.mock.invocationCallOrder[0]!
    )
  })

  it('repairs the opposite direction (dpr-1 backing upscaled on retina)', () => {
    const { pane, handleResize } = makePane({ backingWidth: 1080, cssWidth: 1080, dpr: 2 })
    expect(repairPaneWebglCanvasDprMismatch(pane)).toBe(true)
    expect(handleResize).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when backing matches css times dpr', () => {
    const { pane, handleResize, refresh } = makePane({
      backingWidth: 2160,
      cssWidth: 1080,
      dpr: 2
    })
    expect(repairPaneWebglCanvasDprMismatch(pane)).toBe(false)
    expect(handleResize).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('tolerates sub-pixel rounding without churning', () => {
    // 1080.4 css at dpr 2 rounds to 2161; a 2160 backing is within tolerance.
    const { pane, handleResize } = makePane({ backingWidth: 2160, cssWidth: 1080.4, dpr: 2 })
    expect(repairPaneWebglCanvasDprMismatch(pane)).toBe(false)
    expect(handleResize).not.toHaveBeenCalled()
  })

  it('skips detached, zero-box, and renderer-less panes', () => {
    const detached = makePane({ backingWidth: 2160, cssWidth: 1080, dpr: 1, connected: false })
    expect(repairPaneWebglCanvasDprMismatch(detached.pane)).toBe(false)

    const zeroBox = makePane({ backingWidth: 2160, cssWidth: 0, dpr: 1 })
    expect(repairPaneWebglCanvasDprMismatch(zeroBox.pane)).toBe(false)

    const noRenderer = makePane({ backingWidth: 2160, cssWidth: 1080, dpr: 1, hasRenderer: false })
    expect(repairPaneWebglCanvasDprMismatch(noRenderer.pane)).toBe(false)
  })

  it('reports failure without throwing when the repair path throws mid-teardown', () => {
    const { pane, handleResize } = makePane({ backingWidth: 2160, cssWidth: 1080, dpr: 1 })
    handleResize.mockImplementation(() => {
      throw new Error('disposed')
    })
    expect(repairPaneWebglCanvasDprMismatch(pane)).toBe(false)
  })
})
