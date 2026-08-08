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

  it('rounds down when the nearest step would exceed the residual blur budget', () => {
    const plan = planPreviewFitScale({
      boxWidth: 518,
      screenWidth: 1000,
      currentFontSize: 14,
      baseFontSize: 14
    })
    // ideal 7.252; rounding to 7.5 would require scale(0.967), so use 7px natively.
    expect(plan.fontSize).toBe(7)
    expect(plan.residualScale).toBe(1)
  })

  it('converges instead of alternating across rounded xterm measurements', () => {
    let fontSize = 14
    const plannedSizes: number[] = []
    // These are the observed 84-column widths that previously produced the
    // unbounded 14 -> 6 -> 6.5 -> 6 cycle in a 315px box.
    const measuredWidths = new Map([
      [14, 706],
      [6, 302],
      [6.5, 328]
    ])
    for (let step = 0; step < 5; step += 1) {
      const plan = planPreviewFitScale({
        boxWidth: 315,
        screenWidth: measuredWidths.get(fontSize)!,
        currentFontSize: fontSize,
        baseFontSize: 14,
        maxFontSize: step === 0 ? 14 : fontSize
      })
      fontSize = plan.fontSize
      plannedSizes.push(fontSize)
    }

    expect(plannedSizes).toEqual([6, 6, 6, 6, 6])
  })

  it('holds a same-layout font when residual scaling alone suggests the adjacent step', () => {
    const plan = planPreviewFitScale({
      boxWidth: 372,
      screenWidth: 354,
      currentFontSize: 7,
      baseFontSize: 14,
      maxFontSize: 7
    })
    expect(plan.fontSize).toBe(7)
    expect(plan.residualScale).toBe(1)
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

  it('restores the base font after the preview grid claim succeeds', () => {
    const fallback = planPreviewFitScale({
      boxWidth: 800,
      screenWidth: 1600,
      currentFontSize: 14,
      baseFontSize: 14
    })
    expect(fallback.fontSize).toBe(7)

    // The accepted claim halves the grid, so its 7px rendering is now 400px wide.
    const claimed = planPreviewFitScale({
      boxWidth: 800,
      screenWidth: 400,
      currentFontSize: fallback.fontSize,
      baseFontSize: 14
    })
    expect(claimed.fontSize).toBe(14)
    expect(claimed.residualScale).toBe(1)
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
