import {
  createDefaultWorkspaceCleanupFilterState,
  type WorkspaceCleanupFilterState
} from '../../../../shared/workspace-cleanup-filter-model'

export type WorkspaceCleanupFacetGroupKey = keyof Omit<WorkspaceCleanupFilterState, 'query'>

const FACET_GROUP_KEYS: readonly WorkspaceCleanupFacetGroupKey[] = [
  'activity',
  'size',
  'status',
  'agent',
  'git',
  'review',
  'ticket',
  'context',
  'location',
  'safety'
]

/**
 * Facet groups the user has moved off the default state. Drives the "N filters
 * on" badge, so it compares against defaults rather than against the active
 * preset — a preset is itself just a named filter state.
 */
export function listActiveWorkspaceCleanupFacetGroups(
  filters: WorkspaceCleanupFilterState
): WorkspaceCleanupFacetGroupKey[] {
  const defaults = createDefaultWorkspaceCleanupFilterState()
  return FACET_GROUP_KEYS.filter((key) => !isGroupEqual(filters[key], defaults[key]))
}

export function hasActiveWorkspaceCleanupFilters(filters: WorkspaceCleanupFilterState): boolean {
  return (
    filters.query.trim().length > 0 || listActiveWorkspaceCleanupFacetGroups(filters).length > 0
  )
}

/** Selection order is not meaning, so array members compare as sets. */
function isGroupEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value].map(String).sort()
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    )
    return entries.map(([key, entry]) => [
      key,
      typeof entry === 'string' ? entry.trim() : normalize(entry)
    ])
  }
  return value
}
