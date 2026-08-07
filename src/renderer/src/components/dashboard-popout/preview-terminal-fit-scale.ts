/**
 * Why font-scaling instead of `transform: scale()`: the preview must keep the
 * PTY's real cols/rows (replaying serialized ANSI into different dimensions
 * rewraps into garbage), but CSS-downscaling a rendered terminal resamples the
 * glyph bitmaps into visible smear — the "Orca text is blurry" reports. Scaling
 * the font size instead re-rasterizes every glyph natively at the final size:
 * same grid, crisp text. A residual transform remains only for the sliver the
 * discrete font-size step cannot express, and for the floor below MIN_FONT_PX.
 */

/** Below this, glyphs are unreadable either way; cheaper to transform-scale. */
const MIN_PREVIEW_FONT_PX = 4
/** Ignore sub-2% drift so measure→apply→measure cannot oscillate. */
const FONT_FIT_TOLERANCE = 0.02

export type PreviewFitScalePlan = {
  /** Font size the preview terminal should render at (never above base). */
  fontSize: number
  /** Remaining CSS scale after the font change; 1 means no transform needed. */
  residualScale: number
}

export function planPreviewFitScale(args: {
  boxWidth: number
  /** Current rendered width of the xterm screen element. */
  screenWidth: number
  /** Font size the screen was rendered at (the current terminal option). */
  currentFontSize: number
  /** The settings-configured font size the preview must never exceed. */
  baseFontSize: number
}): PreviewFitScalePlan {
  const { boxWidth, screenWidth, currentFontSize, baseFontSize } = args
  if (boxWidth <= 0 || screenWidth <= 0 || currentFontSize <= 0 || baseFontSize <= 0) {
    return { fontSize: currentFontSize > 0 ? currentFontSize : baseFontSize, residualScale: 1 }
  }
  // Cell width tracks font size near-linearly; one proportional step converges
  // within the tolerance and the residual transform absorbs rounding.
  const naturalWidthAtBase = (screenWidth / currentFontSize) * baseFontSize
  const idealFontSize = baseFontSize * (boxWidth / naturalWidthAtBase)
  const fontSize = Math.round(clamp(idealFontSize, MIN_PREVIEW_FONT_PX, baseFontSize) * 2) / 2
  const withinTolerance =
    Math.abs(fontSize - currentFontSize) / currentFontSize <= FONT_FIT_TOLERANCE
  const effectiveFontSize = withinTolerance ? currentFontSize : fontSize
  const predictedWidth = (screenWidth / currentFontSize) * effectiveFontSize
  const residualScale = Math.min(1, boxWidth / predictedWidth)
  return { fontSize: effectiveFontSize, residualScale }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
