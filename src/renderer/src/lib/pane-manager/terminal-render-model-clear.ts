/**
 * Clears a terminal's per-cell render model WITHOUT touching the shared glyph
 * atlas, so the next refresh rebuilds every visible cell from the buffer.
 *
 * Why this is needed: xterm's renderers are diff-based. `terminal.refresh()`
 * walks the buffer and skips any cell whose code/fg/bg/ext match the render
 * model's cached copy (WebglRenderer._updateModel's "Nothing has changed, no
 * updates needed" early-continue). While a pane is occluded — the window hidden
 * behind another app, the classic "switch away to the desktop" — the compositor
 * can drop the canvas contents while that model stays populated. On return the
 * diff then reports those cells unchanged, the refresh skips them, and the
 * canvas keeps presenting pre-hide pixels until something forces a full
 * rebuild. Resizing the window is what users find, because a resize reallocates
 * the model and repaints everything.
 *
 * `RenderService.clear()` delegates to the active renderer's `clear()`, which
 * calls `_clearModel(true)` — it drops the cached cells and the glyph renderer's
 * vertices but does NOT clear the texture atlas. That distinction matters: the
 * atlas is shared by every same-config terminal, and wiping it mid-stream
 * re-arms xterm's page-merge garble race (xterm.js #4480), which is why the
 * plain-refocus path is deliberately atlas-preserving. Clearing only the model
 * gives a guaranteed full repaint at no cost to sibling panes.
 *
 * All access is behind typeof guards: an xterm upgrade that renames these
 * internals degrades to a no-op (the caller's plain refresh still runs) rather
 * than throwing into a render frame.
 */

type MaybeClearableRenderService = {
  clear?: () => void
}

type TerminalWithRenderService = {
  _core?: {
    _renderService?: MaybeClearableRenderService
  }
}

/**
 * Drops the cached render model so the caller's next refresh repaints every
 * visible cell. Returns whether the model was actually cleared.
 */
export function clearTerminalRenderModel(terminal: unknown): boolean {
  const service = (terminal as TerminalWithRenderService | null)?._core?._renderService
  if (typeof service?.clear !== 'function') {
    return false
  }
  try {
    service.clear()
    return true
  } catch {
    // A pane disposed mid-frame must not break the caller's repaint.
    return false
  }
}
