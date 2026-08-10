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
      spaceWorktrees: s.workspaceSpaceAnalysis?.worktrees ?? null
    }))
  )

  const reviewInfoByWorktreeId = useMemo(() => {
    const infos = new Map<string, WorkspaceCleanupReviewInfo>()
    for (const candidate of candidates) {
      infos.set(candidate.worktreeId, getWorkspaceCleanupReviewInfo(candidate, sources))
    }
    return infos
  }, [candidates, sources])

  const sizeByWorktreeId = useMemo(
    () => buildWorkspaceCleanupSizeIndex(sources.spaceWorktrees),
    [sources.spaceWorktrees]
  )

  const facets = useMemo(
    () =>
      buildWorkspaceCleanupFacetList(candidates, {
        worktreeById: buildWorkspaceCleanupWorktreeIndex(sources.worktreesByRepo),
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
    [candidates, now, reviewInfoByWorktreeId, sizeByWorktreeId, sources]
  )

  const result = useMemo(
    () => runWorkspaceCleanupQuery(facets, { filters, sort }, now),
    [facets, filters, now, sort]
  )
  const facetCounts = useMemo(
    () => countWorkspaceCleanupFacetMatches(facets, filters, now),
    [facets, filters, now]
  )

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
    measuredSizeCount: sizeByWorktreeId.size
  }
}
