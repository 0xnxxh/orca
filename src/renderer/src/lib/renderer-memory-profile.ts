/**
 * Leak-diagnosis counts for renderer_memory_highwater breadcrumbs.
 *
 * Why a contributor registry: crash-diagnostics must stay a leaf module, so
 * subsystems (store, terminals) push their counters in instead of being
 * imported. Counts only — never raw buffers — per the diagnostics budget.
 */

export type RendererMemoryProfileCounts = Record<string, number>

type RendererMemoryProfileContributor = () => RendererMemoryProfileCounts

const contributors = new Map<string, RendererMemoryProfileContributor>()

// Why: breadcrumbs are retained per session; a misbehaving contributor must not
// bloat every crash report. 32 counts is plenty to name a leaking subsystem.
const MAX_COUNTS_PER_CONTRIBUTOR = 32

export function registerRendererMemoryProfileContributor(
  name: string,
  contributor: RendererMemoryProfileContributor
): () => void {
  contributors.set(name, contributor)
  return () => {
    if (contributors.get(name) === contributor) {
      contributors.delete(name)
    }
  }
}

export function collectRendererMemoryProfileCounts(): RendererMemoryProfileCounts {
  const counts: RendererMemoryProfileCounts = {}
  for (const [name, contributor] of contributors) {
    // Why: a broken contributor must never take down memory reporting itself.
    try {
      let kept = 0
      for (const [key, value] of Object.entries(contributor())) {
        if (kept >= MAX_COUNTS_PER_CONTRIBUTOR) {
          break
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
          counts[`${name}.${key}`] = value
          kept += 1
        }
      }
    } catch {
      counts[`${name}.error`] = 1
    }
  }
  return counts
}

/**
 * Sizes of the largest top-level collections in a state object, for spotting
 * which slice grew when the heap high-water mark trips.
 */
export function summarizeStateCollectionSizes(
  state: unknown,
  limit: number
): RendererMemoryProfileCounts {
  if (typeof state !== 'object' || state === null) {
    return {}
  }
  const sizes: [string, number][] = []
  for (const [key, value] of Object.entries(state)) {
    const size = collectionSize(value)
    if (size !== null && size > 0) {
      sizes.push([key, size])
    }
  }
  sizes.sort((a, b) => b[1] - a[1])
  return Object.fromEntries(sizes.slice(0, limit))
}

function collectionSize(value: unknown): number | null {
  if (Array.isArray(value)) {
    return value.length
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size
  }
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value).length
  }
  return null
}
