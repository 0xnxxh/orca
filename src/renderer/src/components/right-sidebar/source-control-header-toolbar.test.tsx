import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SourceControlHeaderToolbar } from './source-control-header-toolbar'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('./source-control-header-overflow-menu', () => ({
  SourceControlHeaderOverflowMenu: () => <button type="button">More actions</button>
}))

vi.mock('./source-control-branch-context-row', () => ({
  shouldShowSourceControlBranchContextRow: () => false,
  SourceControlBranchContextRow: () => null
}))

function renderToolbar(branchName = 'brennanb2025/source-control-branch-name'): string {
  return renderToStaticMarkup(
    <SourceControlHeaderToolbar
      branchName={branchName}
      filterQuery=""
      filterExpanded={false}
      onFilterQueryChange={vi.fn()}
      onFilterExpandedChange={vi.fn()}
      visibleCreatePrHeaderAction={null}
      isCreatePrIntentInFlight={false}
      isCreatingPr={false}
      onCreatePrHeaderClick={vi.fn()}
      sourceControlViewMode="list"
      viewModeToggleDisabled={false}
      onToggleViewMode={vi.fn()}
      onChangeBaseRef={vi.fn()}
      onRefreshBranchCompare={vi.fn()}
      branchCompareRefreshDisabled={false}
      diffCommentCount={0}
      onExpandNotes={vi.fn()}
      branchSummary={null}
      compareBaseRef={null}
    />
  )
}

describe('SourceControlHeaderToolbar', () => {
  it('renders the truncating branch identity before source control actions', () => {
    const markup = renderToolbar()
    const branchIndex = markup.indexOf('brennanb2025/source-control-branch-name')
    const filterIndex = markup.indexOf('data-testid="source-control-filter-toggle"')

    expect(branchIndex).toBeGreaterThan(-1)
    expect(filterIndex).toBeGreaterThan(branchIndex)
    expect(markup).toContain('aria-label="Current branch: brennanb2025/source-control-branch-name"')
    expect(markup).toContain('min-w-0 truncate')
  })

  it('does not announce a branch while HEAD is detached', () => {
    const markup = renderToolbar('')

    expect(markup).not.toContain('aria-label="Current branch:')
    expect(markup).not.toContain('lucide-git-branch')
  })
})
