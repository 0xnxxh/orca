import type { ManagedPane } from './pane-manager-types'
import { recordTerminalWebglDiagnostic } from '../../../../shared/terminal-webgl-diagnostics'

/**
 * Why: when devicePixelRatio changes while a pane is hidden (window moved
 * between retina/non-retina displays, then the worktree revealed), xterm's
 * WebGL renderer re-measures cell dimensions but its canvas keeps the old
 * backing-store size — the addon's own device-pixel observer misses changes
 * that land while the element has no box. The browser then composites the
 * stale-scale bitmap into the css box: half/double-size or smeared text until
 * a real resize. Proven live: backing 2160 px for a 1080 css box at dpr 1.
 * The repair is xterm's own resize path, which recomputes device dimensions
 * at the current dpr and resizes the canvas backing store.
 */
type XtermRendererInternals = {
  _canvas?: HTMLCanvasElement
  _gl?: { canvas?: HTMLCanvasElement }
  handleDevicePixelRatioChange?: () => void
  handleResize?: (cols: number, rows: number) => void
}

// Fractional css widths round differently across zoom levels; one device px of
// slack keeps the check from false-firing on rounding while still catching any
// real dpr mismatch (the smallest is a 1.25x step ≈ 25% of the width).
const BACKING_MISMATCH_TOLERANCE_PX = 1

export function repairPaneWebglCanvasDprMismatch(pane: ManagedPane): boolean {
  const renderer = (
    pane.terminal as unknown as {
      _core?: { _renderService?: { _renderer?: { value?: XtermRendererInternals } } }
    }
  )._core?._renderService?._renderer?.value
  const canvas = renderer?._canvas ?? renderer?._gl?.canvas
  if (!renderer || !canvas?.isConnected) {
    return false
  }
  const view = canvas.ownerDocument?.defaultView
  const rect = canvas.getBoundingClientRect()
  if (!view || rect.width <= 0 || rect.height <= 0) {
    return false
  }
  const expectedWidth = Math.round(rect.width * view.devicePixelRatio)
  const staleBackingWidth = canvas.width
  if (Math.abs(staleBackingWidth - expectedWidth) <= BACKING_MISMATCH_TOLERANCE_PX) {
    return false
  }
  try {
    // Order matters: refresh the renderer's cached dpr/dimensions first, then
    // the resize path recreates the backing store and layer sizes from them.
    renderer.handleDevicePixelRatioChange?.()
    renderer.handleResize?.(pane.terminal.cols, pane.terminal.rows)
    pane.terminal.refresh(0, pane.terminal.rows - 1)
  } catch {
    // Pane may be mid-teardown; the next reveal/fit retries the check.
    return false
  }
  recordTerminalWebglDiagnostic('webgl-canvas-dpr-repair', {
    paneId: pane.id,
    staleBackingWidth,
    expectedBackingWidth: expectedWidth,
    devicePixelRatio: view.devicePixelRatio
  })
  return true
}
