import type { ManagedPane } from './pane-manager-types'
import { recordTerminalWebglDiagnostic } from '../../../../shared/terminal-webgl-diagnostics'
import { canMeasurePaneForFit } from './pane-fit-measurability'

/**
 * Why: the DOM renderer force-aligns its grid with CSS letter-spacing =
 * css.cell.width − measured glyph advance. Healthy values are sub-pixel
 * rounding; a large value means the char-size measurement disagrees with the
 * glyph raster (poisoned by a hidden/mid-transition measure) and every
 * character paints with a visible blank after it ("a b c…") in small-looking
 * glyphs until something re-measures. Field: parked-worktree reveal on large
 * sessions shows it for seconds. Repair at the measurable reveal boundary by
 * re-measuring and rebuilding renderer dimensions, and record the mismatch so
 * occurrences become data.
 */
const MAX_HEALTHY_DEFAULT_SPACING_PX = 1
const unresolvedRepairAttempts = new WeakSet<HTMLElement>()

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
  let rows: HTMLElement | null
  try {
    // Only the DOM renderer has a rows container; WebGL panes never enter here.
    rows = pane.container?.querySelector?.('.xterm-rows') as HTMLElement | null
  } catch {
    return false
  }
  if (!rows) {
    return false
  }
  const spacingText = rows.style.letterSpacing.trim()
  if (!spacingText.endsWith('px')) {
    return false
  }
  const spacing = Number.parseFloat(spacingText)
  const optionSpacing = pane.terminal.options?.letterSpacing
  const configuredSpacing = Number.isFinite(optionSpacing) ? Math.round(optionSpacing ?? 0) : 0
  const unexpectedSpacing = spacing - configuredSpacing
  if (!Number.isFinite(spacing) || Math.abs(unexpectedSpacing) <= MAX_HEALTHY_DEFAULT_SPACING_PX) {
    unresolvedRepairAttempts.delete(rows)
    return false
  }
  // Why: a font whose stable metrics disagree by >1px must not trigger work on every reveal.
  if (unresolvedRepairAttempts.has(rows)) {
    return false
  }
  try {
    if (!canMeasurePaneForFit(pane)) {
      return false
    }
  } catch {
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
    // The reveal measurability gate excludes hidden/zero-size panes. The dpr path
    // also rebuilds default spacing when the char-size value stays unchanged.
    charSize.measure()
    renderer.handleDevicePixelRatioChange()
    if (pane.terminal.rows > 0) {
      pane.terminal.refresh(0, pane.terminal.rows - 1)
    }
  } catch {
    return false
  }
  const afterSpacing = Number.parseFloat(rows.style.letterSpacing)
  const repaired =
    Number.isFinite(afterSpacing) &&
    Math.abs(afterSpacing - configuredSpacing) <= MAX_HEALTHY_DEFAULT_SPACING_PX
  if (repaired) {
    unresolvedRepairAttempts.delete(rows)
  } else {
    unresolvedRepairAttempts.add(rows)
  }
  try {
    recordTerminalWebglDiagnostic('dom-letter-spacing-repair', {
      paneId: pane.id,
      defaultSpacingPx: spacing,
      configuredSpacingPx: configuredSpacing,
      afterSpacingPx: Number.isFinite(afterSpacing) ? afterSpacing : null,
      beforeCellWidth,
      beforeCharWidth,
      afterCharWidth: charSize.width ?? null,
      fontSize: pane.terminal.options?.fontSize ?? null,
      repaired
    })
  } catch {
    // Diagnostics must not escape the renderer recovery boundary.
  }
  return repaired
}
