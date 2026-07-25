import type { BrowserWindow } from 'electron'

// Why: long enough for the emulated viewport to reach the renderer and lay out, short enough
// that a user never sees the 1px overshoot.
export const VIEWPORT_REFLOW_SETTLE_MS = 32

// Why: a restore that keeps failing on a live webContents would loop forever; give up and
// release the latch so a later reveal can try a fresh cycle.
export const VIEWPORT_REFLOW_RESTORE_ATTEMPTS = 3

// Why: overlapping reveals must not stack emulation calls; the outer one owns the restore.
const activeViewportReflows = new WeakSet<BrowserWindow>()

function isWindowGone(window: BrowserWindow): boolean {
  return window.isDestroyed() || window.webContents.isDestroyed()
}

/**
 * Force the renderer to recompute its viewport without touching the native window frame.
 *
 * Why: `webContents.invalidate()` repaints but never reflows, so a stale `dvh` root keeps the
 * status bar clipped off-screen (STA-2383). The frame jiggle that used to fix that mutates
 * NSWindow, which self-deadlocks the main thread on macOS 26's scene-backed windows. Device
 * emulation drives the same resize through the compositor instead — real reflow, no scene update.
 */
export function reflowRendererViewport(window: BrowserWindow): void {
  if (activeViewportReflows.has(window) || isWindowGone(window)) {
    return
  }
  activeViewportReflows.add(window)
  // Why: reveal/resume fire from inside AppKit's dispatch; start on a fresh turn so nothing
  // native runs while that callout frame is still on the stack.
  setTimeout(() => {
    if (isWindowGone(window)) {
      activeViewportReflows.delete(window)
      return
    }
    let emulating = false
    try {
      const [width, height] = window.getContentSize()
      // Why: emulating the current size is a no-op — the +1 delta is what triggers the reflow.
      const viewSize = { width, height: height + 1 }
      window.webContents.enableDeviceEmulation({
        screenPosition: 'desktop',
        // Why: Electron types every field as required, so the rest carry their documented
        // defaults — screenSize is mobile-only, and 0 keeps the real device scale factor.
        screenSize: viewSize,
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 0,
        viewSize,
        scale: 1
      })
      emulating = true
    } catch {
      // Why: a teardown race can destroy the webContents mid-call; nothing was applied.
    }
    if (!emulating) {
      activeViewportReflows.delete(window)
      return
    }
    // Why: emulation must always be undone — leaving it on strands the renderer at the
    // overshot viewport for the rest of the window's life.
    restoreRealViewport(window, 0)
  }, 0)
}

function restoreRealViewport(window: BrowserWindow, attempt: number): void {
  setTimeout(() => {
    if (isWindowGone(window)) {
      // Why: the emulated viewport dies with the webContents, so there is nothing to restore.
      activeViewportReflows.delete(window)
      return
    }
    try {
      window.webContents.disableDeviceEmulation()
      activeViewportReflows.delete(window)
    } catch {
      // Why: the webContents is still alive, so the renderer is stuck at the overshot viewport;
      // keep retrying and hold the latch so no second cycle stacks on the unrestored state.
      if (attempt >= VIEWPORT_REFLOW_RESTORE_ATTEMPTS) {
        activeViewportReflows.delete(window)
        return
      }
      restoreRealViewport(window, attempt + 1)
    }
  }, VIEWPORT_REFLOW_SETTLE_MS)
}
