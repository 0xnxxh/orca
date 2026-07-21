import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { HostedReviewInfo } from '../../../../shared/hosted-review'
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

const hostedReview: HostedReviewInfo = {
  provider: 'github',
  number: 9777,
  title: 'Show the current branch',
  state: 'open',
  url: 'https://github.com/stablyai/orca/pull/9777',
  status: 'pending',
  updatedAt: '2026-07-21T00:00:00Z',
  mergeable: 'UNKNOWN'
}

function renderToolbar(): string {
  return renderToStaticMarkup(
    <SourceControlHeaderToolbar
      branchName="brennanb2025/source-control-branch-name"
      filterQuery=""
      filterExpanded={false}
      onFilterQueryChange={vi.fn()}
      onFilterExpandedChange={vi.fn()}
      visibleCreatePrHeaderAction={null}
      hostedReview={hostedReview}
      isCreatePrIntentInFlight={false}
      isCreatingPr={false}
      onCreatePrHeaderClick={vi.fn()}
      onOpenHostedReviewInChecks={vi.fn()}
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
  it('renders the truncating branch identity before compact review status', () => {
    const markup = renderToolbar()
    const branchIndex = markup.indexOf('brennanb2025/source-control-branch-name')
    const reviewIndex = markup.indexOf('PR #9777')

    expect(branchIndex).toBeGreaterThan(-1)
    expect(reviewIndex).toBeGreaterThan(branchIndex)
    expect(markup).toContain('aria-label="Current branch: brennanb2025/source-control-branch-name"')
    expect(markup).toContain('min-w-0 truncate')
    expect(markup).toContain('max-w-[72px] shrink-0')
  })
})
