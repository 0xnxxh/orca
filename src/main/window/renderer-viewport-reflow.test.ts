import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow } from 'electron'
import { reflowRendererViewport, VIEWPORT_REFLOW_SETTLE_MS } from './renderer-viewport-reflow'

function createWindow(overrides: Record<string, unknown> = {}): BrowserWindow {
  const webContents = {
    isDestroyed: vi.fn(() => false),
    enableDeviceEmulation: vi.fn(),
    disableDeviceEmulation: vi.fn()
  }
  return {
    webContents,
    isDestroyed: vi.fn(() => false),
    getContentSize: vi.fn(() => [1200, 800]),
    setSize: vi.fn(),
    setBounds: vi.fn(),
    ...overrides
  } as unknown as BrowserWindow
}

describe('reflowRendererViewport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('never mutates the native window frame', () => {
    const window = createWindow()
    reflowRendererViewport(window)
    vi.advanceTimersByTime(VIEWPORT_REFLOW_SETTLE_MS + 1)
    expect(window.setSize).not.toHaveBeenCalled()
    expect(window.setBounds).not.toHaveBeenCalled()
  })

  it('defers the emulation off the caller stack, then restores the real viewport', () => {
    const window = createWindow()
    reflowRendererViewport(window)
    // Why: nothing may run while AppKit's callout frame is still on the stack.
    expect(window.webContents.enableDeviceEmulation).not.toHaveBeenCalled()

    vi.advanceTimersByTime(0)
    expect(window.webContents.enableDeviceEmulation).toHaveBeenCalledWith({
      screenPosition: 'desktop',
      screenSize: { width: 1200, height: 801 },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 0,
      viewSize: { width: 1200, height: 801 },
      scale: 1
    })
    expect(window.webContents.disableDeviceEmulation).not.toHaveBeenCalled()

    vi.advanceTimersByTime(VIEWPORT_REFLOW_SETTLE_MS)
    expect(window.webContents.disableDeviceEmulation).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst of reveals into one emulation cycle', () => {
    const window = createWindow()
    for (let i = 0; i < 5; i += 1) {
      reflowRendererViewport(window)
    }
    vi.advanceTimersByTime(VIEWPORT_REFLOW_SETTLE_MS + 1)
    expect(window.webContents.enableDeviceEmulation).toHaveBeenCalledTimes(1)
    expect(window.webContents.disableDeviceEmulation).toHaveBeenCalledTimes(1)
  })

  it('re-arms once the cycle finishes', () => {
    const window = createWindow()
    reflowRendererViewport(window)
    vi.advanceTimersByTime(VIEWPORT_REFLOW_SETTLE_MS + 1)
    reflowRendererViewport(window)
    vi.advanceTimersByTime(VIEWPORT_REFLOW_SETTLE_MS + 1)
    expect(window.webContents.enableDeviceEmulation).toHaveBeenCalledTimes(2)
    expect(window.webContents.disableDeviceEmulation).toHaveBeenCalledTimes(2)
  })

  it('skips a window destroyed before the deferred turn runs', () => {
    const window = createWindow()
    reflowRendererViewport(window)
    vi.mocked(window.isDestroyed).mockReturnValue(true)
    vi.advanceTimersByTime(VIEWPORT_REFLOW_SETTLE_MS + 1)
    expect(window.webContents.enableDeviceEmulation).not.toHaveBeenCalled()
  })

  it('skips a webContents destroyed before the deferred turn runs', () => {
    const window = createWindow()
    reflowRendererViewport(window)
    vi.mocked(window.webContents.isDestroyed).mockReturnValue(true)
    vi.advanceTimersByTime(VIEWPORT_REFLOW_SETTLE_MS + 1)
    expect(window.webContents.enableDeviceEmulation).not.toHaveBeenCalled()
  })

  it('does not leave emulation on when the window dies mid-cycle', () => {
    const window = createWindow()
    reflowRendererViewport(window)
    vi.advanceTimersByTime(0)
    expect(window.webContents.enableDeviceEmulation).toHaveBeenCalledTimes(1)

    vi.mocked(window.isDestroyed).mockReturnValue(true)
    expect(() => vi.advanceTimersByTime(VIEWPORT_REFLOW_SETTLE_MS)).not.toThrow()
    expect(window.webContents.disableDeviceEmulation).not.toHaveBeenCalled()

    // Why: a stuck latch would silently disable every later reflow for this window.
    vi.mocked(window.isDestroyed).mockReturnValue(false)
    reflowRendererViewport(window)
    vi.advanceTimersByTime(VIEWPORT_REFLOW_SETTLE_MS + 1)
    expect(window.webContents.enableDeviceEmulation).toHaveBeenCalledTimes(2)
  })

  it('recovers the latch when enabling emulation throws', () => {
    const window = createWindow()
    vi.mocked(window.webContents.enableDeviceEmulation).mockImplementationOnce(() => {
      throw new Error('Object has been destroyed')
    })
    reflowRendererViewport(window)
    expect(() => vi.advanceTimersByTime(VIEWPORT_REFLOW_SETTLE_MS + 1)).not.toThrow()
    // Why: nothing was applied, so no restore should be attempted.
    expect(window.webContents.disableDeviceEmulation).not.toHaveBeenCalled()

    reflowRendererViewport(window)
    vi.advanceTimersByTime(VIEWPORT_REFLOW_SETTLE_MS + 1)
    expect(window.webContents.enableDeviceEmulation).toHaveBeenCalledTimes(2)
  })

  it('recovers the latch when disabling emulation throws', () => {
    const window = createWindow()
    vi.mocked(window.webContents.disableDeviceEmulation).mockImplementationOnce(() => {
      throw new Error('Object has been destroyed')
    })
    reflowRendererViewport(window)
    expect(() => vi.advanceTimersByTime(VIEWPORT_REFLOW_SETTLE_MS + 1)).not.toThrow()

    reflowRendererViewport(window)
    vi.advanceTimersByTime(VIEWPORT_REFLOW_SETTLE_MS + 1)
    expect(window.webContents.enableDeviceEmulation).toHaveBeenCalledTimes(2)
  })
})
