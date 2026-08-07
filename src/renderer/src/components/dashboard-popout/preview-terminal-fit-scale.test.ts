import { describe, expect, it } from 'vitest'
import { planPreviewFitScale } from './preview-terminal-fit-scale'

describe('planPreviewFitScale', () => {
  it('keeps the base font and no transform when the screen already fits', () => {
    const plan = planPreviewFitScale({
      boxWidth: 900,
      screenWidth: 800,
      currentFontSize: 14,
      baseFontSize: 14
    })
    expect(plan.fontSize).toBe(14)
    expect(plan.residualScale).toBe(1)
  })

  it('shrinks the font instead of relying on a large transform', () => {
    // Source pane ~2x wider than the box: the old code applied scale(0.5) and
    // smeared every glyph. The plan must express (almost) all of it as font.
    const plan = planPreviewFitScale({
      boxWidth: 500,
      screenWidth: 1000,
      currentFontSize: 14,
      baseFontSize: 14
    })
    expect(plan.fontSize).toBe(7)
    expect(plan.residualScale).toBe(1)
  })

  it('leaves only a sub-step residual for non-half-px ratios', () => {
    const plan = planPreviewFitScale({
      boxWidth: 530,
      screenWidth: 1000,
      currentFontSize: 14,
      baseFontSize: 14
    })
    // ideal 7.42 → rounds to 7.5; predicted width 1000*7.5/14 ≈ 535.7 → tiny shrink.
    expect(plan.fontSize).toBe(7.5)
    expect(plan.residualScale).toBeGreaterThan(0.97)
    expect(plan.residualScale).toBeLessThan(1)
  })

  it('never scales the font above the settings base when the box grows back', () => {
    const plan = planPreviewFitScale({
      boxWidth: 2000,
      screenWidth: 500,
      currentFontSize: 7,
      baseFontSize: 14
    })
    expect(plan.fontSize).toBe(14)
    expect(plan.residualScale).toBe(1)
  })

  it('holds steady within tolerance so measure-apply loops cannot oscillate', () => {
    // After the first shrink lands, the re-measure produces a near-identical
    // ideal; a repeated plan must return the current font unchanged.
    const settled = planPreviewFitScale({
      boxWidth: 500,
      screenWidth: 501,
      currentFontSize: 7,
      baseFontSize: 14
    })
    expect(settled.fontSize).toBe(7)
    expect(settled.residualScale).toBeGreaterThan(0.99)
  })

  it('falls back to transform below the minimum readable font', () => {
    const plan = planPreviewFitScale({
      boxWidth: 100,
      screenWidth: 1000,
      currentFontSize: 14,
      baseFontSize: 14
    })
    expect(plan.fontSize).toBe(4)
    // 1000*4/14 ≈ 285.7 wide at the floor → the rest stays a transform.
    expect(plan.residualScale).toBeCloseTo(100 / (1000 * (4 / 14)), 3)
  })

  it('is inert on degenerate measurements', () => {
    expect(
      planPreviewFitScale({ boxWidth: 0, screenWidth: 0, currentFontSize: 14, baseFontSize: 14 })
    ).toEqual({ fontSize: 14, residualScale: 1 })
  })
})
