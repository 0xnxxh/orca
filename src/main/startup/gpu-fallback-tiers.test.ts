import { describe, expect, it } from 'vitest'
import {
  MAX_GPU_FALLBACK_TIER,
  clampGpuFallbackTier,
  getGpuFallbackTierSwitches,
  getNextGpuFallbackTier,
  isGpuFallbackTier
} from './gpu-fallback-tiers'

describe('gpu-fallback-tiers', () => {
  it('escalates one rung at a time and stops at the top', () => {
    expect(getNextGpuFallbackTier(0)).toBe(1)
    expect(getNextGpuFallbackTier(1)).toBe(2)
    expect(getNextGpuFallbackTier(2)).toBe(3)
    expect(getNextGpuFallbackTier(3)).toBeNull()
  })

  // Why: null is what bounds relaunches per build; a non-null answer here is a crash loop.
  it('never escalates past the ladder for out-of-range input', () => {
    expect(getNextGpuFallbackTier(99)).toBeNull()
    expect(getNextGpuFallbackTier(Number.POSITIVE_INFINITY)).toBeNull()
    expect(getNextGpuFallbackTier(Number.NaN)).toBe(1)
    expect(getNextGpuFallbackTier(-5)).toBe(1)
  })

  it('clamps untrusted persisted tiers', () => {
    expect(clampGpuFallbackTier(undefined)).toBe(1)
    expect(clampGpuFallbackTier('2')).toBe(1)
    expect(clampGpuFallbackTier(0)).toBe(1)
    expect(clampGpuFallbackTier(2)).toBe(2)
    expect(clampGpuFallbackTier(2.7)).toBe(2)
    expect(clampGpuFallbackTier(999)).toBe(MAX_GPU_FALLBACK_TIER)
  })

  it('identifies ladder members', () => {
    expect(isGpuFallbackTier(1)).toBe(true)
    expect(isGpuFallbackTier(0)).toBe(false)
    expect(isGpuFallbackTier(4)).toBe(false)
  })

  // Why: escalating must never drop a switch a lower tier already needed.
  it('is additive across tiers', () => {
    const names = ([1, 2, 3] as const).map(
      (tier) => new Set(getGpuFallbackTierSwitches(tier).map((entry) => entry.name))
    )
    for (const name of names[0]) {
      expect(names[1].has(name)).toBe(true)
    }
    for (const name of names[1]) {
      expect(names[2].has(name)).toBe(true)
    }
  })

  it('removes the GPU child process at the top tier', () => {
    const tier1 = getGpuFallbackTierSwitches(1).map((entry) => entry.name)
    expect(tier1).toEqual(['disable-gpu'])

    const tier2 = getGpuFallbackTierSwitches(2)
    expect(tier2.map((entry) => entry.name)).toContain('disable-gpu-compositing')
    expect(tier2.find((entry) => entry.name === 'use-angle')?.value).toBe('swiftshader')

    expect(getGpuFallbackTierSwitches(3).map((entry) => entry.name)).toContain('in-process-gpu')
  })
})
