import {
  isEmptyLinearIssueAttributeFilter,
  linearIssueAttributeFilterSignature,
  type LinearIssueAttributeFilter
} from '../../../shared/linear-issue-attribute-filter'
import {
  getTaskSourceCacheScope,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import type { LinearIssueListReadArgs } from '../store/slices/linear'

export function isLinearIssueSearchActive(immediateQuery: string, appliedQuery: string): boolean {
  return immediateQuery.trim().length > 0 || appliedQuery.trim().length > 0
}

export function buildLinearIssueListReadArgs(options: {
  filter?: 'assigned' | 'created' | 'all' | 'completed'
  limit: number
  attributeFilter: LinearIssueAttributeFilter
  searchActive: boolean
  /** Concrete workspace only; `all` must never send workspace-scoped facet ids. */
  allowAttributeFilter?: boolean
}): LinearIssueListReadArgs {
  const attributeFilter =
    options.searchActive ||
    options.allowAttributeFilter === false ||
    isEmptyLinearIssueAttributeFilter(options.attributeFilter)
      ? undefined
      : options.attributeFilter
  return {
    kind: 'list',
    filter: options.filter ?? 'all',
    limit: options.limit,
    attributeFilter
  }
}

export function buildLinearIssueListRequestSignature(options: {
  sourceContext?: TaskSourceContext | null
  workspaceId: string | null | undefined
  filter?: 'assigned' | 'created' | 'all' | 'completed'
  limit: number
  attributeFilter: LinearIssueAttributeFilter
  searchQuery?: string
}): string {
  const sourceScope = options.sourceContext
    ? getTaskSourceCacheScope(options.sourceContext)
    : 'local'
  const workspace = options.workspaceId ?? 'default'
  if (options.searchQuery && options.searchQuery.trim().length > 0) {
    return `${sourceScope}::${workspace}::search::${options.searchQuery.trim()}`
  }
  const signature = linearIssueAttributeFilterSignature(options.attributeFilter)
  return `${sourceScope}::${workspace}::list::${options.filter ?? 'all'}::${options.limit}::${signature}`
}

export function shouldForceLinearIssueListRead(options: {
  /** `null` until this session's first list read; a restored filter is a baseline, not a change. */
  previousFilterSignature: string | null
  nextFilterSignature: string
  refreshForced: boolean
}): boolean {
  if (options.refreshForced) {
    return true
  }
  // Why: forcing the very first read would bypass warm cache and show the blocking
  // spinner on every cold start that restores a persisted filter.
  if (options.previousFilterSignature === null) {
    return false
  }
  // Why: filter signature changes always need a current server read, even when
  // returning to a previously cached signature that is still warm.
  return options.previousFilterSignature !== options.nextFilterSignature
}

/** Where a primary team was observed; the team catalog is Linear-workspace scoped. */
export type LinearPrimaryTeamObservation = { workspaceId: string | null; teamId: string }

/**
 * Only an in-workspace primary-team change invalidates team-scoped facets. A
 * workspace switch also changes the primary team, but it swaps in that workspace's
 * own persisted filter — clearing there would erase the restored state.
 */
export function shouldClearTeamDerivedFacets(options: {
  previous: LinearPrimaryTeamObservation | null
  next: LinearPrimaryTeamObservation
}): boolean {
  const { previous, next } = options
  if (!previous) {
    return false
  }
  return previous.workspaceId === next.workspaceId && previous.teamId !== next.teamId
}

export function teamDerivedFacetsForPrimaryTeamChange(
  current: LinearIssueAttributeFilter
): LinearIssueAttributeFilter {
  // Why: status/assignee/labels are team-scoped ids; priority is global 0..4.
  return {
    stateIds: [],
    priorities: current.priorities,
    assignee: null,
    labelIds: []
  }
}
