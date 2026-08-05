// Why: single source of truth for the Linear issue list's persisted view state.
// The renderer's in-memory state, TaskResumeState, and the strict `ui.set` RPC
// schema all derive from these catalogs, so none of the three can drift apart.
// Persisted values are untrusted input: normalize before use, never assume shape.

import {
  canonicalizeLinearIssueAttributeFilter,
  emptyLinearIssueAttributeFilter,
  isEmptyLinearIssueAttributeFilter,
  linearIssueAttributeFilterSignature,
  parseLinearIssueAttributeFilter,
  LINEAR_ISSUE_ATTRIBUTE_FILTER_ID_MAX_LENGTH,
  type LinearIssueAttributeFilter
} from './linear-issue-attribute-filter'

export const LINEAR_VIEW_MODES = ['list', 'board'] as const
export const LINEAR_GROUP_BY_OPTIONS = ['none', 'status', 'assignee', 'priority', 'team'] as const
export const LINEAR_ORDER_BY_OPTIONS = ['priority', 'updated', 'identifier'] as const
/** Catalog order doubles as the canonical serialization order for display properties. */
export const LINEAR_DISPLAY_PROPERTIES = [
  'state',
  'priority',
  'assignee',
  'team',
  'labels',
  'updated'
] as const

export type LinearViewMode = (typeof LINEAR_VIEW_MODES)[number]
export type LinearGroupBy = (typeof LINEAR_GROUP_BY_OPTIONS)[number]
export type LinearOrderBy = (typeof LINEAR_ORDER_BY_OPTIONS)[number]
export type LinearDisplayProperty = (typeof LINEAR_DISPLAY_PROPERTIES)[number]

export const DEFAULT_LINEAR_VIEW_MODE: LinearViewMode = 'list'
export const DEFAULT_LINEAR_GROUP_BY: LinearGroupBy = 'none'
export const DEFAULT_LINEAR_ORDER_BY: LinearOrderBy = 'priority'

/** Bounds the persisted map; a user works out of a handful of Linear workspaces. */
export const LINEAR_ISSUE_VIEW_MAX_PERSISTED_WORKSPACES = 20

export type LinearIssueViewResumeState = {
  viewMode: LinearViewMode
  groupBy: LinearGroupBy
  orderBy: LinearOrderBy
  displayProperties: LinearDisplayProperty[]
  /** True once the user toggles the Team column, which disables the single-team auto-hide. */
  teamPropertyTouched: boolean
  /** Facet ids (states, labels, users) are Linear-workspace scoped, so filters are kept per workspace. */
  filtersByWorkspaceId: Record<string, LinearIssueAttributeFilter>
}

/** Serialization input: the renderer holds display properties as a Set. */
export type LinearIssueViewSelection = Omit<LinearIssueViewResumeState, 'displayProperties'> & {
  displayProperties: Iterable<LinearDisplayProperty>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMember<T extends string>(catalog: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (catalog as readonly string[]).includes(value)
}

export function defaultLinearIssueViewResumeState(): LinearIssueViewResumeState {
  return {
    viewMode: DEFAULT_LINEAR_VIEW_MODE,
    groupBy: DEFAULT_LINEAR_GROUP_BY,
    orderBy: DEFAULT_LINEAR_ORDER_BY,
    displayProperties: [...LINEAR_DISPLAY_PROPERTIES],
    teamPropertyTouched: false,
    filtersByWorkspaceId: {}
  }
}

/** Emits catalog order so toggling a property off and back on produces an identical payload. */
export function orderLinearDisplayProperties(
  selected: Iterable<LinearDisplayProperty>
): LinearDisplayProperty[] {
  const chosen = new Set(selected)
  return LINEAR_DISPLAY_PROPERTIES.filter((property) => chosen.has(property))
}

// Why: assigning `__proto__` on a plain object hits the inherited setter, so an
// untrusted key of that name must never reach the record being built.
function isSafeWorkspaceKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= LINEAR_ISSUE_ATTRIBUTE_FILTER_ID_MAX_LENGTH &&
    key !== '__proto__'
  )
}

function normalizeFiltersByWorkspaceId(value: unknown): Record<string, LinearIssueAttributeFilter> {
  if (!isPlainObject(value)) {
    return {}
  }
  const next: Record<string, LinearIssueAttributeFilter> = {}
  for (const [workspaceId, filter] of Object.entries(value)) {
    if (!isSafeWorkspaceKey(workspaceId)) {
      continue
    }
    let parsed: LinearIssueAttributeFilter
    try {
      parsed = parseLinearIssueAttributeFilter(filter)
    } catch {
      // Why: one corrupt workspace entry must not discard the other workspaces' filters.
      continue
    }
    if (isEmptyLinearIssueAttributeFilter(parsed)) {
      continue
    }
    next[workspaceId] = parsed
  }
  return trimToMostRecentWorkspaces(next)
}

// Why: writes append newly filtered workspaces, so the tail is the most recent.
function trimToMostRecentWorkspaces(
  filters: Record<string, LinearIssueAttributeFilter>
): Record<string, LinearIssueAttributeFilter> {
  const entries = Object.entries(filters)
  if (entries.length <= LINEAR_ISSUE_VIEW_MAX_PERSISTED_WORKSPACES) {
    return filters
  }
  return Object.fromEntries(entries.slice(-LINEAR_ISSUE_VIEW_MAX_PERSISTED_WORKSPACES))
}

/** Validates untrusted persisted state; returns undefined when nothing worth restoring survives. */
export function normalizeLinearIssueViewResumeState(
  value: unknown
): LinearIssueViewResumeState | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const next = defaultLinearIssueViewResumeState()
  if (isMember(LINEAR_VIEW_MODES, value.viewMode)) {
    next.viewMode = value.viewMode
  }
  if (isMember(LINEAR_GROUP_BY_OPTIONS, value.groupBy)) {
    next.groupBy = value.groupBy
  }
  if (isMember(LINEAR_ORDER_BY_OPTIONS, value.orderBy)) {
    next.orderBy = value.orderBy
  }
  // Why: an empty array is meaningful (every property hidden), so only a non-array falls back.
  const displayProperties: unknown = value.displayProperties
  if (Array.isArray(displayProperties)) {
    next.displayProperties = LINEAR_DISPLAY_PROPERTIES.filter((property) =>
      displayProperties.includes(property)
    )
  }
  if (typeof value.teamPropertyTouched === 'boolean') {
    next.teamPropertyTouched = value.teamPropertyTouched
  }
  next.filtersByWorkspaceId = normalizeFiltersByWorkspaceId(value.filtersByWorkspaceId)
  return isDefaultLinearIssueViewResumeState(next) ? undefined : next
}

export function resolveLinearIssueViewResumeState(value: unknown): LinearIssueViewResumeState {
  return normalizeLinearIssueViewResumeState(value) ?? defaultLinearIssueViewResumeState()
}

export function isDefaultLinearIssueViewResumeState(view: LinearIssueViewResumeState): boolean {
  return (
    view.viewMode === DEFAULT_LINEAR_VIEW_MODE &&
    view.groupBy === DEFAULT_LINEAR_GROUP_BY &&
    view.orderBy === DEFAULT_LINEAR_ORDER_BY &&
    view.teamPropertyTouched === false &&
    view.displayProperties.length === LINEAR_DISPLAY_PROPERTIES.length &&
    Object.keys(view.filtersByWorkspaceId).length === 0
  )
}

/** Canonical persisted payload: catalog-ordered properties, canonical filters, empties omitted. */
export function serializeLinearIssueViewResumeState(
  view: LinearIssueViewSelection
): LinearIssueViewResumeState {
  const filtersByWorkspaceId: Record<string, LinearIssueAttributeFilter> = {}
  for (const [workspaceId, filter] of Object.entries(view.filtersByWorkspaceId)) {
    if (!isSafeWorkspaceKey(workspaceId) || isEmptyLinearIssueAttributeFilter(filter)) {
      continue
    }
    filtersByWorkspaceId[workspaceId] = canonicalizeLinearIssueAttributeFilter(filter)
  }
  return {
    viewMode: view.viewMode,
    groupBy: view.groupBy,
    orderBy: view.orderBy,
    displayProperties: orderLinearDisplayProperties(view.displayProperties),
    teamPropertyTouched: view.teamPropertyTouched,
    filtersByWorkspaceId: trimToMostRecentWorkspaces(filtersByWorkspaceId)
  }
}

/**
 * The active filter is derived from the selected workspace rather than reset on
 * switch, so no effect ordering can leave workspace A's facets applied to B.
 * A null id (Linear unresolved, disconnected, or the cross-workspace "all" view)
 * yields an empty filter while leaving every persisted workspace filter intact.
 */
export function selectLinearWorkspaceIssueFilter(
  filters: Record<string, LinearIssueAttributeFilter>,
  workspaceId: string | null
): LinearIssueAttributeFilter {
  if (!workspaceId) {
    return emptyLinearIssueAttributeFilter()
  }
  const filter = Object.prototype.hasOwnProperty.call(filters, workspaceId)
    ? filters[workspaceId]
    : undefined
  return filter ? canonicalizeLinearIssueAttributeFilter(filter) : emptyLinearIssueAttributeFilter()
}

/** Returns the same reference when the workspace's canonical filter is unchanged. */
export function setLinearWorkspaceIssueFilter(
  filters: Record<string, LinearIssueAttributeFilter>,
  workspaceId: string,
  filter: LinearIssueAttributeFilter
): Record<string, LinearIssueAttributeFilter> {
  if (!isSafeWorkspaceKey(workspaceId)) {
    return filters
  }
  const current = selectLinearWorkspaceIssueFilter(filters, workspaceId)
  if (
    linearIssueAttributeFilterSignature(current) === linearIssueAttributeFilterSignature(filter)
  ) {
    return filters
  }
  const next = { ...filters }
  if (isEmptyLinearIssueAttributeFilter(filter)) {
    delete next[workspaceId]
    return next
  }
  next[workspaceId] = canonicalizeLinearIssueAttributeFilter(filter)
  return trimToMostRecentWorkspaces(next)
}
