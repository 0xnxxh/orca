// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultWorkspaceCleanupFilterState } from '../../../../shared/workspace-cleanup-filter-model'
import { WorkspaceCleanupFilterBar } from './workspace-cleanup-filter-bar'

afterEach(cleanup)

function renderFilterBar(facetPanelOpen = false): void {
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
      facetPanelOpen={facetPanelOpen}
      onFacetPanelOpenChange={vi.fn()}
      activeFacetGroupCount={0}
      matchedCount={100}
      hasActiveFilters={false}
      gitEvidence={{ pendingCount: 0, totalCount: 0 }}
      onQueryChange={vi.fn()}
      onClearFilters={vi.fn()}
    />
  )
}

describe('WorkspaceCleanupFilterBar', () => {
  it('keeps size measurement out of the browse controls', () => {
    renderFilterBar()

    expect(screen.queryByRole('button', { name: 'Scan' })).toBeNull()
  })

  it('caps the facet panel height on the scroll viewport so it stays scrollable', () => {
    renderFilterBar(true)

    // Why: on the ScrollArea Root the cap only clips — the h-full viewport
    // collapses under an indefinite height and the last facet groups become
    // unreachable behind the footer.
    const viewport = document.querySelector('[data-slot="scroll-area-viewport"]')
    const root = document.querySelector('[data-slot="scroll-area"]')
    expect(viewport?.className).toContain('max-h-[420px]')
    expect(root?.className).not.toContain('max-h-')
  })
})
