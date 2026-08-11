import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { getLiveAgentStatusByWorktreeId } from '@/lib/worktree-activity-state'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type { HostedReviewProvider } from '../../../../shared/hosted-review'
import type { WorkspaceCleanupCandidate } from '../../../../shared/workspace-cleanup'
import type {
  WorkspaceCleanupFilterState,
  WorkspaceCleanupSortState
} from '../../../../shared/workspace-cleanup-filter-model'
import {
  buildWorkspaceCleanupFacetList,
  buildWorkspaceCleanupSizeIndex,
  buildWorkspaceCleanupWorktreeIndex,
  countWorkspaceCleanupMeasuredRows,
  type WorkspaceCleanupFacets
} from './workspace-cleanup-facets'
import {
  countWorkspaceCleanupFacetMatches,
  runWorkspaceCleanupQuery
} from './workspace-cleanup-query'
import {
  getWorkspaceCleanupReviewInfo,
  type WorkspaceCleanupReviewInfo
} from './workspace-cleanup-presentation'
import type {
  WorkspaceCleanupFacetCounts,
  WorkspaceCleanupFacetOptions
} from './workspace-cleanup-facet-panel-model'

export type WorkspaceCleanupFacetRows = {
  rows: WorkspaceCleanupFacets[]
  selectableWorktreeIds: string[]
  matchedCount: number
  totalCount: number
  facetCounts: WorkspaceCleanupFacetCounts
  options: WorkspaceCleanupFacetOptions
  reviewInfoByWorktreeId: ReadonlyMap<string, WorkspaceCleanupReviewInfo>
  sizeByWorktreeId: ReadonlyMap<string, number>
  /** 0 means the workspace-space scan has never produced a usable size. */
  measuredSizeCount: number
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

  const reviewInfoByWorktreeId = useMemo(() => {
    const infos = new Map<string, WorkspaceCleanupReviewInfo>()
    const reviewSources = { hostedReviewCache, repos, settings, worktreesByRepo }
    for (const candidate of candidates) {
      infos.set(candidate.worktreeId, getWorkspaceCleanupReviewInfo(candidate, reviewSources))
    }
    return infos
  }, [candidates, hostedReviewCache, repos, settings, worktreesByRepo])

  const completedSizeByWorktreeId = useMemo(
    () => buildWorkspaceCleanupSizeIndex(sources.spaceWorktrees),
    [sources.spaceWorktrees]
  )
  const sizeByWorktreeId = useMemo(() => {
    if (sources.spaceMeasurements.length === 0) {
      return completedSizeByWorktreeId
    }
    return new Map([
      ...completedSizeByWorktreeId,
      ...buildWorkspaceCleanupSizeIndex(sources.spaceMeasurements)
    ])
  }, [completedSizeByWorktreeId, sources.spaceMeasurements])

  const facets = useMemo(
    () =>
      buildWorkspaceCleanupFacetList(candidates, {
        worktreeById: buildWorkspaceCleanupWorktreeIndex(sources.worktreesByRepo),
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
      sources.worktreesByRepo
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
  const measuredSizeCount = useMemo(() => countWorkspaceCleanupMeasuredRows(facets), [facets])

  const options = useMemo<WorkspaceCleanupFacetOptions>(
    () => ({
      workspaceStatuses: sources.workspaceStatuses.map((status) => ({
        id: status.id,
        label: status.label
      })),
      hostIds: [...new Set(facets.map((row) => row.hostId))].sort(),
      repos: sources.repos
        .filter((repo) => isGitRepoKind(repo))
        .map((repo) => ({ id: repo.id, label: repo.displayName || repo.path })),
      reviewProviders: [
        ...new Set(
          facets
            .map((row) => row.review.provider)
            .filter((provider): provider is HostedReviewProvider => provider !== null)
        )
      ].sort()
    }),
    [facets, sources.repos, sources.workspaceStatuses]
  )

  return {
    rows: result.rows,
    selectableWorktreeIds: result.selectableWorktreeIds,
    matchedCount: result.matchedCount,
    totalCount: result.totalCount,
    facetCounts,
    options,
    reviewInfoByWorktreeId,
    sizeByWorktreeId,
    measuredSizeCount
  }
}
