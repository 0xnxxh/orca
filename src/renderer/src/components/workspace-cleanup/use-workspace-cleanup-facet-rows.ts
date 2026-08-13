import { useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { getLiveAgentStatusByWorktreeId } from '@/lib/worktree-activity-state'
import type { HostedReviewProvider } from '../../../../shared/hosted-review'
import type { WorkspaceCleanupCandidate } from '../../../../shared/workspace-cleanup'
import type {
  WorkspaceCleanupFilterState,
  WorkspaceCleanupSortState
} from '../../../../shared/workspace-cleanup-filter-model'
import {
  countWorkspaceCleanupMeasuredRows,
  type WorkspaceCleanupFacets
} from './workspace-cleanup-facets'
import {
  countWorkspaceCleanupFacetMatches,
  filterWorkspaceCleanupFacets,
  runWorkspaceCleanupQuery
} from './workspace-cleanup-query'
import {
  buildWorkspaceCleanupReviewLookup,
  type WorkspaceCleanupReviewInfo
} from './workspace-cleanup-presentation'
import type {
  WorkspaceCleanupFacetCounts,
  WorkspaceCleanupFacetOptions
} from './workspace-cleanup-facet-panel-model'
import {
  buildWorkspaceCleanupSizeIndex,
  buildWorkspaceCleanupWorktreeIndex,
  countWorkspaceCleanupCandidateIds
} from './workspace-cleanup-host-identity'
import {
  computeWorkspaceCleanupFacetList,
  computeWorkspaceCleanupReviewInfoIndex,
  type WorkspaceCleanupFacetListCache,
  type WorkspaceCleanupReviewInfoCache
} from './workspace-cleanup-facet-row-caches'

export type WorkspaceCleanupFacetRows = {
  rows: WorkspaceCleanupFacets[]
  selectableWorktreeIds: string[]
  facetMatchedWorktreeIds: ReadonlySet<string>
  matchedCount: number
  totalCount: number
  facetCounts: WorkspaceCleanupFacetCounts
  options: WorkspaceCleanupFacetOptions
  reviewInfoByWorktreeId: ReadonlyMap<string, WorkspaceCleanupReviewInfo>
  sizeByWorktreeId: ReadonlyMap<string, number>
  /** 0 means the workspace-space scan has never produced a usable size. */
  measuredSizeCount: number
  unmeasuredSizeCount: number
}

const EMPTY_FACET_COUNTS: WorkspaceCleanupFacetCounts = Object.freeze({
  activity: 0,
  size: 0,
  status: 0,
  agent: 0,
  git: 0,
  review: 0,
  ticket: 0,
  context: 0,
  location: 0,
  safety: 0
})

const EMPTY_FACET_OPTIONS: WorkspaceCleanupFacetOptions = Object.freeze({
  workspaceStatuses: Object.freeze([]),
  hostIds: Object.freeze([]),
  repos: Object.freeze([]),
  reviewProviders: Object.freeze([])
})

/**
 * Joins the scan rows with everything the flat list filters and sorts on:
 * renderer-only signals (visits, live agents, review cache, dismissals) plus
 * sizes from the EXISTING workspace-space scan — no second scanner.
 *
 * Per-candidate work is cached on candidate object identity (see
 * workspace-cleanup-facet-row-caches) so streaming ticks touch only changed
 * rows and no-op ticks skip every downstream pass.
 */
export function useWorkspaceCleanupFacetRows({
  candidates,
  filters,
  sort,
  now,
  facetPanelOpen = true
}: {
  candidates: readonly WorkspaceCleanupCandidate[]
  filters: WorkspaceCleanupFilterState
  sort: WorkspaceCleanupSortState
  now: number
  /** Facet counts/options are only rendered inside the filter popover; pass
   * false while it is closed to skip their O(N) passes entirely. */
  facetPanelOpen?: boolean
}): WorkspaceCleanupFacetRows {
  const sources = useAppStore(
    useShallow((s) => ({
      worktreesByRepo: s.worktreesByRepo,
      hostedReviewCache: s.hostedReviewCache,
      repos: s.repos,
      settings: s.settings,
      // Statuses are a top-level UI-slice field, not part of GlobalSettings.
      workspaceStatuses: s.workspaceStatuses,
      lastVisitedAtByWorktreeId: s.lastVisitedAtByWorktreeId,
      agentStatusByPaneKey: s.agentStatusByPaneKey,
      tabsByWorktree: s.tabsByWorktree,
      dismissals: s.workspaceCleanupDismissals,
      spaceWorktrees: s.workspaceSpaceAnalysis?.worktrees ?? null,
      spaceMeasurements: s.workspaceSpaceMeasurements
    }))
  )
  const { hostedReviewCache, repos, settings, worktreesByRepo } = sources
  const candidateIdCounts = useMemo(
    () => countWorkspaceCleanupCandidateIds(candidates),
    [candidates]
  )
  const reviewLookup = useMemo(
    () => buildWorkspaceCleanupReviewLookup({ repos, worktreesByRepo }),
    [repos, worktreesByRepo]
  )
  const worktreeById = useMemo(
    () => buildWorkspaceCleanupWorktreeIndex(worktreesByRepo, repos),
    [repos, worktreesByRepo]
  )
  const liveAgentStatusByWorktreeId = useMemo(
    () => getLiveAgentStatusByWorktreeId(sources.agentStatusByPaneKey, sources.tabsByWorktree, now),
    [now, sources.agentStatusByPaneKey, sources.tabsByWorktree]
  )
  const dismissedWorktreeIds = useMemo(
    () => new Set(Object.keys(sources.dismissals)),
    [sources.dismissals]
  )

  const reviewCacheRef = useRef<WorkspaceCleanupReviewInfoCache | null>(null)
  const reviewInfoByWorktreeId = useMemo(() => {
    const { cache, infos } = computeWorkspaceCleanupReviewInfoIndex({
      candidates,
      candidateIdCounts,
      reviewSources: { hostedReviewCache, repos, settings, worktreesByRepo },
      reviewLookup,
      cache: reviewCacheRef.current
    })
    reviewCacheRef.current = cache
    return infos
  }, [
    candidateIdCounts,
    candidates,
    hostedReviewCache,
    repos,
    reviewLookup,
    settings,
    worktreesByRepo
  ])

  const completedSizeByWorktreeId = useMemo(
    () => buildWorkspaceCleanupSizeIndex(sources.spaceWorktrees, candidates),
    [candidates, sources.spaceWorktrees]
  )
  const sizeByWorktreeId = useMemo(() => {
    if (sources.spaceMeasurements.length === 0) {
      return completedSizeByWorktreeId
    }
    return new Map([
      ...completedSizeByWorktreeId,
      ...buildWorkspaceCleanupSizeIndex(sources.spaceMeasurements, candidates)
    ])
  }, [candidates, completedSizeByWorktreeId, sources.spaceMeasurements])

  const facetCacheRef = useRef<WorkspaceCleanupFacetListCache | null>(null)
  const facets = useMemo(() => {
    const { cache, list } = computeWorkspaceCleanupFacetList({
      candidates,
      sources: {
        worktreeById,
        workspaceStatuses: sources.workspaceStatuses,
        sizeBytesByWorktreeId: sizeByWorktreeId,
        lastVisitedAtByWorktreeId: sources.lastVisitedAtByWorktreeId,
        liveAgentStatusByWorktreeId,
        reviewInfoByWorktreeId,
        dismissedWorktreeIds
      },
      cache: facetCacheRef.current
    })
    facetCacheRef.current = cache
    return list
  }, [
    candidates,
    dismissedWorktreeIds,
    liveAgentStatusByWorktreeId,
    reviewInfoByWorktreeId,
    sizeByWorktreeId,
    sources.lastVisitedAtByWorktreeId,
    sources.workspaceStatuses,
    worktreeById
  ])

  const result = useMemo(
    () => runWorkspaceCleanupQuery(facets, { filters, sort }, now),
    [facets, filters, now, sort]
  )
  const facetFilters = useMemo<WorkspaceCleanupFilterState>(
    () => ({
      query: '',
      activity: filters.activity,
      size: filters.size,
      status: filters.status,
      agent: filters.agent,
      git: filters.git,
      review: filters.review,
      ticket: filters.ticket,
      context: filters.context,
      location: filters.location,
      safety: filters.safety
    }),
    [
      filters.activity,
      filters.agent,
      filters.context,
      filters.git,
      filters.location,
      filters.review,
      filters.safety,
      filters.size,
      filters.status,
      filters.ticket
    ]
  )
  const facetCounts = useMemo(
    () =>
      facetPanelOpen
        ? countWorkspaceCleanupFacetMatches(facets, facetFilters, now)
        : EMPTY_FACET_COUNTS,
    [facetFilters, facetPanelOpen, facets, now]
  )
  const matchedIdsRef = useRef<ReadonlySet<string>>(new Set())
  const facetMatchedWorktreeIds = useMemo(() => {
    const next = new Set(
      filterWorkspaceCleanupFacets(facets, facetFilters, now).map((row) => row.worktreeId)
    )
    const previous = matchedIdsRef.current
    // Why: destructive selection pruning keys off this set; identity must only
    // change when membership does.
    if (previous.size === next.size && [...next].every((id) => previous.has(id))) {
      return previous
    }
    matchedIdsRef.current = next
    return next
  }, [facetFilters, facets, now])
  const measuredSizeCount = useMemo(() => countWorkspaceCleanupMeasuredRows(facets), [facets])
  const unmeasuredSizeCount = facets.length - measuredSizeCount

  const options = useMemo<WorkspaceCleanupFacetOptions>(() => {
    if (!facetPanelOpen) {
      return EMPTY_FACET_OPTIONS
    }
    const repoLabels = new Map<string, string>()
    for (const row of facets) {
      if (!repoLabels.has(row.repoId)) {
        repoLabels.set(row.repoId, row.repoName)
      }
    }
    return {
      workspaceStatuses: sources.workspaceStatuses.map((status) => ({
        id: status.id,
        label: status.label
      })),
      hostIds: [...new Set(facets.map((row) => row.hostId))].sort(),
      repos: [...repoLabels].map(([id, label]) => ({ id, label })),
      reviewProviders: [
        ...new Set(
          facets
            .map((row) => row.review.provider)
            .filter((provider): provider is HostedReviewProvider => provider !== null)
        )
      ].sort()
    }
  }, [facetPanelOpen, facets, sources.workspaceStatuses])

  return {
    rows: result.rows,
    selectableWorktreeIds: result.selectableWorktreeIds,
    facetMatchedWorktreeIds,
    matchedCount: result.matchedCount,
    totalCount: result.totalCount,
    facetCounts,
    options,
    reviewInfoByWorktreeId,
    sizeByWorktreeId,
    measuredSizeCount,
    unmeasuredSizeCount
  }
}
