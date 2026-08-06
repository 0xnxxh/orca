import type { ManagedPaneInternal } from './pane-manager-types'
import { reattachWebglIfNeeded } from './pane-webgl-reattach'
import { resetAndRefreshAllTerminalWebglAtlases } from './pane-manager-registry'
import { invalidateTerminalRenderModel } from './terminal-render-model-invalidation'

type PaneGetter = () => Iterable<ManagedPaneInternal>

const pendingRevealRepaints: {
  getPanes: PaneGetter
  invalidatePaneId?: number
}[] = []
let revealRepaintScheduled = false

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

function flushPaneRevealRepaints(): void {
  revealRepaintScheduled = false
  const paneGetters = pendingRevealRepaints.splice(0)
  const livePanes = new Map<ManagedPaneInternal, boolean>()

  for (const { getPanes, invalidatePaneId } of paneGetters) {
    try {
      for (const pane of getPanes()) {
        livePanes.set(pane, livePanes.get(pane) === true || pane.id === invalidatePaneId)
      }
    } catch {
      /* ignore — a manager may be destroyed while its repaint is pending */
    }
  }

  for (const [pane, shouldInvalidate] of livePanes) {
    try {
      reattachWebglIfNeeded(pane)
      if (shouldInvalidate && pane.webglAddon && !pane.webglDisabledAfterContextLoss) {
        invalidateTerminalRenderModel(pane.terminal)
      }
    } catch {
      /* ignore — one pane's teardown must not block global recovery */
    }
  }
  if (livePanes.size > 0) {
    resetAndRefreshAllTerminalWebglAtlases('settled-reveal')
  }
}

/**
 * Repaints a revealed tab's panes from their xterm buffers.
 *
 * Why: while a pane is hidden, parsed output can update the WebGL renderer's
 * per-cell model without ever presenting a frame. At reveal the model diff
 * reports those cells unchanged, so plain refreshes skip them and the canvas
 * keeps compositing pre-hide pixels. Once layout settles, invalidate the
 * replayed pane's model before one registry-wide atlas reset and refresh.
 */
export function schedulePaneRevealRepaint(
  getPanes: () => Iterable<ManagedPaneInternal>,
  options?: { invalidatePaneId?: number }
): void {
  pendingRevealRepaints.push({ getPanes, invalidatePaneId: options?.invalidatePaneId })
  if (revealRepaintScheduled) {
    return
  }
  revealRepaintScheduled = true
  scheduleSettledFrame(flushPaneRevealRepaints)
}

/**
 * Presents already-visible panes without clearing the shared glyph atlas.
 *
 * Why: a plain window refocus never hid its panes, so their WebGL model is
 * already current — a `refresh` re-presents the live buffer (covering a
 * compositor that dropped frames while occluded). Using the atlas-clearing
 * reveal repaint here would wipe the atlas shared by every same-config pane and
 * re-arm the mid-stream page-merge garble race (xterm.js issue 4480); this path
 * must stay texture-atlas-preserving.
 */
export function schedulePaneRevealPresent(getPanes: () => Iterable<ManagedPaneInternal>): void {
  forEachPaneOnSettledFrame(getPanes, (pane) => {
    reattachWebglIfNeeded(pane)
    if (pane.terminal.rows > 0) {
      pane.terminal.refresh(0, pane.terminal.rows - 1)
    }
  })
}
