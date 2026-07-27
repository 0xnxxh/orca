import type { ManagedPaneInternal } from './pane-manager-types'
import { reattachWebglIfNeeded } from './pane-webgl-reattach'
import { resetWebglTextureAtlas } from './pane-webgl-renderer'
import { releaseAbandonedSynchronizedOutput } from './terminal-synchronized-output-release'
import { clearTerminalRenderModel } from './terminal-render-model-clear'

function scheduleSettledFrame(callback: () => void): void {
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    globalThis.setTimeout(callback, 0)
    return
  }
  // Why: the first frame after a reveal can still be laying out the tab
  // overlay; the WebGL renderer silently drops redraw requests until the pane
  // is attached and measured, so repaint on the frame after layout settles.
  globalThis.requestAnimationFrame(() => {
    globalThis.requestAnimationFrame(callback)
  })
}

function forEachPaneOnSettledFrame(
  getPanes: () => Iterable<ManagedPaneInternal>,
  visit: (pane: ManagedPaneInternal) => void
): void {
  scheduleSettledFrame(() => {
    for (const pane of getPanes()) {
      try {
        visit(pane)
      } catch {
        /* ignore — one pane's failure must not block repaint of the rest */
      }
    }
  })
}

/**
 * Repaints a revealed tab's panes from their xterm buffers.
 *
 * Why: while a pane is hidden, parsed output can update the WebGL renderer's
 * per-cell model without ever presenting a frame. At reveal the model diff
 * reports those cells unchanged, so plain refreshes skip them and the canvas
 * keeps compositing pre-hide pixels until a selection or resize rebuilds the
 * model. Clearing the model per pane — after (re)attach, once layout has
 * settled — forces a full rebuild from the buffer without any PTY resize.
 */
export function schedulePaneRevealRepaint(getPanes: () => Iterable<ManagedPaneInternal>): void {
  forEachPaneOnSettledFrame(getPanes, (pane) => {
    reattachWebglIfNeeded(pane)
    resetWebglTextureAtlas(pane)
  })
}

/**
 * Repaints already-visible panes without clearing the shared glyph atlas.
 *
 * Why the model clear: a `refresh` alone is diff-based, so it skips every cell
 * whose cached model entry still matches the buffer. An occluded window (the
 * "switch away to the desktop" case) can lose its canvas contents while that
 * model stays populated, and the refresh then skips exactly the cells that went
 * stale — the pane keeps presenting pre-hide pixels until a resize rebuilds
 * everything. Clearing the model first makes the refresh a guaranteed full
 * repaint.
 *
 * Why not the atlas-clearing reveal repaint: that wipes the atlas shared by
 * every same-config pane and re-arms the mid-stream page-merge garble race
 * (xterm.js issue 4480). Clearing only the model repaints this pane in full
 * while leaving sibling panes' glyphs intact, so this path stays
 * texture-atlas-preserving.
 */
export function schedulePaneRevealPresent(getPanes: () => Iterable<ManagedPaneInternal>): void {
  forEachPaneOnSettledFrame(getPanes, (pane) => {
    reattachWebglIfNeeded(pane)
    // Why before the refresh: while a TUI's synchronized-output frame is
    // latched, RenderService buffers refreshes instead of rendering them, so
    // this present would paint nothing. See terminal-synchronized-output-release.
    releaseAbandonedSynchronizedOutput(pane.terminal)
    clearTerminalRenderModel(pane.terminal)
    if (pane.terminal.rows > 0) {
      pane.terminal.refresh(0, pane.terminal.rows - 1)
    }
  })
}
