import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TERMINAL_FONT_WEIGHT,
  DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
  resolveTerminalFontWeights,
  normalizeTerminalFontWeight,
  normalizeTerminalFontWeightBold
} from './terminal-fonts'

describe('terminal font weights', () => {
  it('falls back to the Orca default when the value is missing', () => {
    expect(normalizeTerminalFontWeight(undefined)).toBe(DEFAULT_TERMINAL_FONT_WEIGHT)
    expect(normalizeTerminalFontWeightBold(undefined)).toBe(DEFAULT_TERMINAL_FONT_WEIGHT_BOLD)
  })

  it('clamps both weights to the supported xterm range', () => {
    expect(normalizeTerminalFontWeight(10)).toBe(100)
    expect(normalizeTerminalFontWeight(1200)).toBe(900)
    expect(normalizeTerminalFontWeightBold(10)).toBe(100)
    expect(normalizeTerminalFontWeightBold(1200)).toBe(900)
  })

  it('defaults to a pair that straddles the boundary between real font faces', () => {
    expect(resolveTerminalFontWeights(undefined, undefined)).toEqual({
      fontWeight: 500,
      fontWeightBold: 700
    })
  })

  // STA-4071: the old behaviour derived bold as max(700, regular + 200). That
  // reads as "always heavier" but is not, because a family exposes only a few
  // real faces — the monospace the default chain resolves to on macOS has two,
  // splitting at 600. So a base weight of 800 derived 900, both rasterized
  // identically, and bold silently stopped existing for every base weight at or
  // above 600 with no way to fix it from the UI.
  it('does not derive bold from the base weight', () => {
    expect(resolveTerminalFontWeights(800, undefined)).toEqual({
      fontWeight: 800,
      fontWeightBold: DEFAULT_TERMINAL_FONT_WEIGHT_BOLD
    })
    // The user owns the pair, including combinations the derivation could never
    // produce — a collision is now a choice they can see and undo.
    expect(resolveTerminalFontWeights(300, 400)).toEqual({
      fontWeight: 300,
      fontWeightBold: 400
    })
    expect(resolveTerminalFontWeights(700, 700)).toEqual({
      fontWeight: 700,
      fontWeightBold: 700
    })
  })
})
