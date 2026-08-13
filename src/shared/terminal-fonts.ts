export const DEFAULT_TERMINAL_FONT_WEIGHT = 500
export const TERMINAL_FONT_WEIGHT_MIN = 100
export const TERMINAL_FONT_WEIGHT_MAX = 900
export const TERMINAL_FONT_WEIGHT_STEP = 100
export const DEFAULT_TERMINAL_FONT_WEIGHT_BOLD = 700

function normalizeWeight(fontWeight: number | null | undefined, fallback: number): number {
  const numericFontWeight = typeof fontWeight === 'number' ? fontWeight : Number.NaN

  if (!Number.isFinite(numericFontWeight)) {
    return fallback
  }

  return Math.min(
    TERMINAL_FONT_WEIGHT_MAX,
    Math.max(TERMINAL_FONT_WEIGHT_MIN, Math.round(numericFontWeight))
  )
}

export function normalizeTerminalFontWeight(fontWeight: number | null | undefined): number {
  return normalizeWeight(fontWeight, DEFAULT_TERMINAL_FONT_WEIGHT)
}

export function normalizeTerminalFontWeightBold(fontWeight: number | null | undefined): number {
  return normalizeWeight(fontWeight, DEFAULT_TERMINAL_FONT_WEIGHT_BOLD)
}

/**
 * Why the bold weight is now its own setting instead of `max(700, regular + 200)`:
 * that derivation silently destroyed bold. A family exposes a small number of
 * real faces — the monospace the default chain resolves to on macOS has exactly
 * two, so every weight 100-500 rasterizes identically and every weight 600-900
 * rasterizes identically. Any regular weight at or above 600 put both values in
 * the same face, so bold stopped existing, with no error and nothing the user
 * could do about it (STA-4071).
 *
 * Arithmetic cannot fix that: on a two-face family there is no heavier face to
 * escape to. So the pair is user-owned. A collision is now a choice the user
 * made and can undo rather than something the app did to them, and the default
 * pair (500/700) straddles the boundary on the families we ship.
 */
export function resolveTerminalFontWeights(
  fontWeight: number | null | undefined,
  fontWeightBold: number | null | undefined
): {
  fontWeight: number
  fontWeightBold: number
} {
  return {
    fontWeight: normalizeTerminalFontWeight(fontWeight),
    fontWeightBold: normalizeTerminalFontWeightBold(fontWeightBold)
  }
}
