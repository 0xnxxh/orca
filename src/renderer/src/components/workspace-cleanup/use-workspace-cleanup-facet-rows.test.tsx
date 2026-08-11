// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import {
  createDefaultWorkspaceCleanupFilterState,
  DEFAULT_WORKSPACE_CLEANUP_SORT
} from '../../../../shared/workspace-cleanup-filter-model'
import { cloneDefaultWorkspaceStatuses } from '../../../../shared/workspace-statuses'
import type * as FacetModule from './workspace-cleanup-facets'
import type * as QueryModule from './workspace-cleanup-query'
import { makeFacetCandidate } from './workspace-cleanup-facet.test.fixture'

const holders = vi.hoisted(() => ({ state: null as AppState | null }))
const counts = vi.hoisted(() => ({ facetCounts: 0, measured: 0, queries: 0 }))

vi.mock('@/store', () => ({
  useAppStore: <T,>(selector: (state: AppState) => T): T => {
    if (!holders.state) {
      throw new Error('Missing test state')
    }
    return selector(holders.state)
  }
}))

vi.mock('./workspace-cleanup-facets', async (importOriginal) => {
  const actual = await importOriginal<typeof FacetModule>()
  return {
    ...actual,
    countWorkspaceCleanupMeasuredRows: (
      ...args: Parameters<typeof actual.countWorkspaceCleanupMeasuredRows>
    ) => {
      counts.measured += 1
      return actual.countWorkspaceCleanupMeasuredRows(...args)
    }
  }
})

vi.mock('./workspace-cleanup-query', async (importOriginal) => {
  const actual = await importOriginal<typeof QueryModule>()
  return {
    ...actual,
    countWorkspaceCleanupFacetMatches: (
      ...args: Parameters<typeof actual.countWorkspaceCleanupFacetMatches>
    ) => {
      counts.facetCounts += 1
      return actual.countWorkspaceCleanupFacetMatches(...args)
    },
    runWorkspaceCleanupQuery: (...args: Parameters<typeof actual.runWorkspaceCleanupQuery>) => {
      counts.queries += 1
      return actual.runWorkspaceCleanupQuery(...args)
    }
  }
})

import { useWorkspaceCleanupFacetRows } from './use-workspace-cleanup-facet-rows'

function makeState(): AppState {
  return {
    worktreesByRepo: {},
    hostedReviewCache: {},
    repos: [],
    settings: {},
    workspaceStatuses: cloneDefaultWorkspaceStatuses(),
    lastVisitedAtByWorktreeId: {},
    agentStatusByPaneKey: {},
    tabsByWorktree: {},
    workspaceCleanupDismissals: {},
    workspaceSpaceAnalysis: null,
    workspaceSpaceMeasurements: []
  } as unknown as AppState
}

describe('useWorkspaceCleanupFacetRows hot paths', () => {
  beforeEach(() => {
    holders.state = makeState()
    counts.facetCounts = 0
    counts.measured = 0
    counts.queries = 0
  })

  it('does only the query work when the user types', () => {
    const candidates = [makeFacetCandidate()]
    const filters = createDefaultWorkspaceCleanupFilterState()
    const view = renderHook(
      ({ currentFilters }) =>
        useWorkspaceCleanupFacetRows({
          candidates,
          filters: currentFilters,
          sort: DEFAULT_WORKSPACE_CLEANUP_SORT,
          now: 1_700_000_000_000
        }),
      { initialProps: { currentFilters: filters } }
    )
    const initialCounts = { ...counts }
    const reviewIndex = view.result.current.reviewInfoByWorktreeId

    view.rerender({ currentFilters: { ...filters, query: 'alpha' } })

    expect(counts.queries).toBeGreaterThan(initialCounts.queries)
    expect(counts.facetCounts).toBe(initialCounts.facetCounts)
    expect(counts.measured).toBe(initialCounts.measured)
    expect(view.result.current.reviewInfoByWorktreeId).toBe(reviewIndex)
  })

  it('keeps review joins stable during unrelated agent-status churn', () => {
    const candidates = [makeFacetCandidate()]
    const filters = createDefaultWorkspaceCleanupFilterState()
    const view = renderHook(() =>
      useWorkspaceCleanupFacetRows({
        candidates,
        filters,
        sort: DEFAULT_WORKSPACE_CLEANUP_SORT,
        now: 1_700_000_000_000
      })
    )
    const reviewIndex = view.result.current.reviewInfoByWorktreeId

    holders.state = { ...holders.state!, agentStatusByPaneKey: {} }
    view.rerender()

    expect(view.result.current.reviewInfoByWorktreeId).toBe(reviewIndex)
  })

  it('does not rebuild facets for count-only size progress', () => {
    const candidates = [makeFacetCandidate()]
    const filters = createDefaultWorkspaceCleanupFilterState()
    const view = renderHook(() =>
      useWorkspaceCleanupFacetRows({
        candidates,
        filters,
        sort: DEFAULT_WORKSPACE_CLEANUP_SORT,
        now: 1_700_000_000_000
      })
    )
    const initialCounts = { ...counts }

    holders.state = {
      ...holders.state!,
      workspaceSpaceScanProgress: {
        scanId: 'scan-1',
        state: 'running',
        startedAt: 1,
        updatedAt: 2,
        totalRepoCount: 1,
        scannedRepoCount: 0,
        totalWorktreeCount: 100,
        scannedWorktreeCount: 20,
        currentRepoDisplayName: 'Repo',
        currentWorktreeDisplayName: 'alpha'
      }
    }
    view.rerender()

    expect(counts).toEqual(initialCounts)
  })

  it('projects streamed size measurements before the full scan completes', () => {
    const candidates = [makeFacetCandidate()]
    const filters = createDefaultWorkspaceCleanupFilterState()
    const view = renderHook(() =>
      useWorkspaceCleanupFacetRows({
        candidates,
        filters,
        sort: DEFAULT_WORKSPACE_CLEANUP_SORT,
        now: 1_700_000_000_000
      })
    )
    expect(view.result.current.rows[0]?.sizeBytes).toBeNull()

    holders.state = {
      ...holders.state!,
      workspaceSpaceMeasurements: [
        { worktreeId: candidates[0]!.worktreeId, status: 'ok', sizeBytes: 4_096 }
      ]
    }
    view.rerender()

    expect(view.result.current.rows[0]?.sizeBytes).toBe(4_096)
    expect(view.result.current.measuredSizeCount).toBe(1)
  })
})
