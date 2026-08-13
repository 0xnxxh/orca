import { useMemo } from 'react'
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
  buildWorkspaceCleanupFacetList,
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
  getWorkspaceCleanupReviewInfo,
  type WorkspaceCleanupReviewInfo
} from './workspace-cleanup-presentation'
import type {
  WorkspaceCleanupFacetCounts,
  WorkspaceCleanupFacetOptions
} from './workspace-cleanup-facet-panel-model'
import {
  buildWorkspaceCleanupSizeIndex,
  buildWorkspaceCleanupWorktreeIndex,
  countWorkspaceCleanupCandidateIds,
  getWorkspaceCleanupCandidateHostId,
  getWorkspaceCleanupHostIdentity
} from './workspace-cleanup-host-identity'

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

/**
 * Joins the scan rows with everything the flat list filters and sorts on:
 * renderer-only signals (visits, live agents, review cache, dismissals) plus
 * sizes from the EXISTING workspace-space scan — no second scanner.
 */
export function useWorkspaceCleanupFacetRows({
  candidates,
  filters,
  sort,
  now
}: {
  candidates: readonly WorkspaceCleanupCandidate[]
  filters: WorkspaceCleanupFilterState
  sort: WorkspaceCleanupSortState
  now: number
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

  const reviewInfoByWorktreeId = useMemo(() => {
    const infos = new Map<string, WorkspaceCleanupReviewInfo>()
    const reviewSources = { hostedReviewCache, repos, settings, worktreesByRepo }
    for (const candidate of candidates) {
      const info = getWorkspaceCleanupReviewInfo(candidate, reviewSources, reviewLookup)
      infos.set(
        getWorkspaceCleanupHostIdentity(
          getWorkspaceCleanupCandidateHostId(candidate),
          candidate.worktreeId
        ),
        info
      )
      if (candidateIdCounts.get(candidate.worktreeId) === 1) {
        infos.set(candidate.worktreeId, info)
      }
    }
    return infos
  }, [candidateIdCounts, candidates, hostedReviewCache, reviewLookup, settings])

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

  const facets = useMemo(
    () =>
      buildWorkspaceCleanupFacetList(candidates, {
        worktreeById: buildWorkspaceCleanupWorktreeIndex(sources.worktreesByRepo, sources.repos),
        workspaceStatuses: sources.workspaceStatuses,
        sizeBytesByWorktreeId: sizeByWorktreeId,
        lastVisitedAtByWorktreeId: sources.lastVisitedAtByWorktreeId,
        liveAgentStatusByWorktreeId: getLiveAgentStatusByWorktreeId(
          sources.agentStatusByPaneKey,
          sources.tabsByWorktree,
          now
        ),
        reviewInfoByWorktreeId,
        dismissedWorktreeIds: new Set(Object.keys(sources.dismissals))
      }),
    [
      candidates,
      now,
      reviewInfoByWorktreeId,
      sizeByWorktreeId,
      sources.agentStatusByPaneKey,
      sources.dismissals,
      sources.lastVisitedAtByWorktreeId,
      sources.tabsByWorktree,
      sources.workspaceStatuses,
      sources.worktreesByRepo,
      sources.repos
    ]
  )

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
    () => countWorkspaceCleanupFacetMatches(facets, facetFilters, now),
    [facets, facetFilters, now]
  )
  const facetMatchedWorktreeIds = useMemo(
    () =>
      new Set(filterWorkspaceCleanupFacets(facets, facetFilters, now).map((row) => row.worktreeId)),
    [facets, facetFilters, now]
  )
  const measuredSizeCount = useMemo(() => countWorkspaceCleanupMeasuredRows(facets), [facets])
  const unmeasuredSizeCount = facets.length - measuredSizeCount

  const options = useMemo<WorkspaceCleanupFacetOptions>(() => {
    const repos = new Map<string, string>()
    for (const row of facets) {
      if (!repos.has(row.repoId)) {
        repos.set(row.repoId, row.repoName)
      }
    }
    return {
      workspaceStatuses: sources.workspaceStatuses.map((status) => ({
        id: status.id,
        label: status.label
      })),
      hostIds: [...new Set(facets.map((row) => row.hostId))].sort(),
      repos: [...repos].map(([id, label]) => ({ id, label })),
      reviewProviders: [
        ...new Set(
          facets
            .map((row) => row.review.provider)
            .filter((provider): provider is HostedReviewProvider => provider !== null)
        )
      ].sort()
    }
  }, [facets, sources.workspaceStatuses])

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
