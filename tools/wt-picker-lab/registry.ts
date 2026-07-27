import type { DesignVariant } from './design-contract'
import { baselineVariant } from './variants/baseline'

/**
 * Agent-authored variants are appended here. Each module default-exports an
 * array of DesignVariant so an agent owns exactly one file.
 */
const variantModules = import.meta.glob<{ default: DesignVariant[] }>('./variants/design-*.tsx', {
  eager: true
})

export const ALL_VARIANTS: DesignVariant[] = [
  baselineVariant,
  ...Object.keys(variantModules)
    .sort()
    .flatMap((key) => variantModules[key].default ?? [])
]
