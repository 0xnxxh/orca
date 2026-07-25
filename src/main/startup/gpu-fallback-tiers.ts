/**
 * Escalation ladder for the Windows GPU-crash fallback.
 *
 * `--disable-gpu` alone does not stop Chromium from spawning a GPU child for the
 * Viz display compositor, so a driver that CHECK-crashes at GPU init keeps
 * killing every launch even with the fallback applied. Each tier removes
 * strictly more of the GPU process from the path; tier 3 removes the child
 * process entirely, which is the only shape a GPU-init crash cannot survive.
 *
 * Tiers are additive on purpose: escalating never drops a switch that a lower
 * tier already needed.
 */

export const GPU_FALLBACK_TIERS = [1, 2, 3] as const

export type GpuFallbackTier = (typeof GPU_FALLBACK_TIERS)[number]

export const MIN_GPU_FALLBACK_TIER: GpuFallbackTier = 1
export const MAX_GPU_FALLBACK_TIER: GpuFallbackTier = 3

/** Tier 0 means "no fallback applied to this launch". */
export const NO_GPU_FALLBACK_TIER = 0

export type GpuFallbackSwitch = { name: string; value?: string }

const TIER_SWITCHES: Record<GpuFallbackTier, readonly GpuFallbackSwitch[]> = {
  1: [{ name: 'disable-gpu' }],
  2: [
    { name: 'disable-gpu' },
    // Why: moves the display compositor off the GPU child, which tier 1 still spawned.
    { name: 'disable-gpu-compositing' },
    // Why: keeps a broken vendor D3D11 driver DLL out of the process even when Chromium still initializes ANGLE.
    { name: 'use-angle', value: 'swiftshader' }
  ],
  3: [
    { name: 'disable-gpu' },
    { name: 'disable-gpu-compositing' },
    { name: 'use-angle', value: 'swiftshader' },
    // Why: last resort — no GPU child exists, so a GPU-init CHECK crash can no longer loop the app.
    { name: 'in-process-gpu' }
  ]
}

export function isGpuFallbackTier(value: unknown): value is GpuFallbackTier {
  return GPU_FALLBACK_TIERS.some((tier) => tier === value)
}

/** Coerces a persisted/untrusted tier onto the ladder; anything unrecognized starts at tier 1. */
export function clampGpuFallbackTier(value: unknown): GpuFallbackTier {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return MIN_GPU_FALLBACK_TIER
  }
  const rounded = Math.trunc(value)
  if (rounded <= MIN_GPU_FALLBACK_TIER) {
    return MIN_GPU_FALLBACK_TIER
  }
  return rounded >= MAX_GPU_FALLBACK_TIER ? MAX_GPU_FALLBACK_TIER : (rounded as GpuFallbackTier)
}

export function getGpuFallbackTierSwitches(tier: GpuFallbackTier): readonly GpuFallbackSwitch[] {
  return TIER_SWITCHES[tier]
}

/**
 * Next rung above `currentTier` (0 = nothing applied yet), or null once the
 * ladder is exhausted. Null is what bounds relaunches to 3 per build.
 */
export function getNextGpuFallbackTier(currentTier: number): GpuFallbackTier | null {
  if (Number.isNaN(currentTier) || currentTier < MIN_GPU_FALLBACK_TIER) {
    return MIN_GPU_FALLBACK_TIER
  }
  if (currentTier >= MAX_GPU_FALLBACK_TIER) {
    return null
  }
  const next = Math.trunc(currentTier) + 1
  return isGpuFallbackTier(next) ? next : null
}
