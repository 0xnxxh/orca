import type { ManagedPane } from './pane-manager-types'
import { recordTerminalWebglDiagnostic } from '../../../../shared/terminal-webgl-diagnostics'

/**
 * Why: the DOM renderer force-aligns its grid with CSS letter-spacing =
 * css.cell.width − measured glyph advance. Healthy values are sub-pixel
 * rounding; a large value means the char-size measurement disagrees with the
 * glyph raster (poisoned by a hidden/mid-transition measure) and every
 * character paints with a visible blank after it ("a b c…") in small-looking
 * glyphs until something re-measures. Field: parked-worktree reveal on large
 * sessions shows it for seconds. Repair at the fit-success boundary — the
 * pane provably has a live box there — by re-measuring and rebuilding the
 * renderer dimensions, and record the mismatch so occurrences become data.
 */
const MAX_HEALTHY_DEFAULT_SPACING_PX = 1

type XtermCoreInternals = {
  _core?: {
    _charSizeService?: { measure?: () => void; width?: number; height?: number }
    _renderService?: {
      _renderer?: { value?: { handleDevicePixelRatioChange?: () => void } }
      dimensions?: { css?: { cell?: { width?: number } } }
    }
  }
}

export function repairPaneDomLetterSpacingMismatch(pane: ManagedPane): boolean {
  // Only the DOM renderer has a rows container; WebGL panes never enter here.
  const rows = pane.container?.querySelector?.('.xterm-rows') as HTMLElement | null
  if (!rows) {
    return false
  }
  const spacing = Number.parseFloat(rows.style.letterSpacing || '0')
  if (!Number.isFinite(spacing) || Math.abs(spacing) <= MAX_HEALTHY_DEFAULT_SPACING_PX) {
    return false
  }
  const core = (pane.terminal as unknown as XtermCoreInternals)._core
  const charSize = core?._charSizeService
  const renderer = core?._renderService?._renderer?.value
  if (!charSize?.measure || !renderer?.handleDevicePixelRatioChange) {
    return false
  }
  const beforeCellWidth = core?._renderService?.dimensions?.css?.cell?.width ?? null
  const beforeCharWidth = charSize.width ?? null
  try {
    // Fit success guarantees a measurable box, and xterm's measure() ignores a
    // zero-size result — this cannot re-poison the latch it clears. The dpr
    // path rebuilds dimensions + default spacing even when the re-measure
    // lands on unchanged values (width-cache-side disagreement).
    charSize.measure()
    renderer.handleDevicePixelRatioChange()
    pane.terminal.refresh(0, pane.terminal.rows - 1)
  } catch {
    return false
  }
  recordTerminalWebglDiagnostic('dom-letter-spacing-repair', {
    paneId: pane.id,
    defaultSpacingPx: spacing,
    beforeCellWidth,
    beforeCharWidth,
    afterCharWidth: charSize.width ?? null,
    fontSize: pane.terminal.options?.fontSize ?? null
  })
  return true
}
