// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultWorkspaceCleanupFilterState } from '../../../../shared/workspace-cleanup-filter-model'
import { WorkspaceCleanupFilterBar } from './workspace-cleanup-filter-bar'

afterEach(cleanup)

describe('WorkspaceCleanupFilterBar', () => {
  it('shows determinate size-scan progress', () => {
    render(
      <WorkspaceCleanupFilterBar
        facetProps={{
          filters: createDefaultWorkspaceCleanupFilterState(),
          counts: {
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
          },
          totalCount: 100,
          options: { workspaceStatuses: [], hostIds: [], repos: [], reviewProviders: [] },
          onPatch: vi.fn()
        }}
        activeFacetGroupCount={0}
        matchedCount={100}
        hasActiveFilters={false}
        sizeScan={{
          measuredCount: 23,
          unmeasuredCount: 77,
          scanning: true,
          scannedCount: 23,
          totalCount: 100,
          onRun: vi.fn()
        }}
        gitEvidence={{ pendingCount: 0, totalCount: 0 }}
        onQueryChange={vi.fn()}
        onClearFilters={vi.fn()}
      />
    )

    expect(
      (screen.getByRole('button', { name: 'Measuring 23/100' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('keeps measurement available while any row is unmeasured', () => {
    render(
      <WorkspaceCleanupFilterBar
        facetProps={{
          filters: createDefaultWorkspaceCleanupFilterState(),
          counts: {
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
          },
          totalCount: 100,
          options: { workspaceStatuses: [], hostIds: [], repos: [], reviewProviders: [] },
          onPatch: vi.fn()
        }}
        activeFacetGroupCount={0}
        matchedCount={100}
        hasActiveFilters={false}
        sizeScan={{
          measuredCount: 23,
          unmeasuredCount: 77,
          scanning: false,
          scannedCount: 23,
          totalCount: 100,
          onRun: vi.fn()
        }}
        gitEvidence={{ pendingCount: 0, totalCount: 0 }}
        onQueryChange={vi.fn()}
        onClearFilters={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Measure sizes' })).toBeTruthy()
  })
})
