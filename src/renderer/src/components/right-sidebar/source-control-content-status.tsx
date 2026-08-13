import React from 'react'
import type { GitConflictOperation } from '../../../../shared/git-status-types'
import { ConflictSummaryCard, OperationBanner } from './source-control-conflict-status-cards'
import { EmptyState } from './source-control-empty-state'
import { TooManyChangesBanner } from './source-control-too-many-changes-banner'

export function SourceControlContentStatus({
  unresolvedConflictCount,
  conflictOperation,
  sourceControlAiActionsVisible,
  isAbortingOperation,
  onAbortOperation,
  onResolveWithAi,
  onReviewConflicts,
  repositoryHuge,
  worktreeId,
  onRetryStatus,
  showGenericEmptyState,
  normalizedFilter,
  branchBaseRef,
  filterTooLarge,
  hasFilteredUncommittedEntries,
  hasFilteredBranchEntries,
  filterQuery
}: {
  unresolvedConflictCount: number
  conflictOperation: GitConflictOperation
  sourceControlAiActionsVisible: boolean
  isAbortingOperation: boolean
  onAbortOperation: (operation: GitConflictOperation) => void
  onResolveWithAi: () => void
  onReviewConflicts: () => void
  repositoryHuge: { limit: number } | null | undefined
  worktreeId: string
  onRetryStatus: (signal: AbortSignal) => Promise<void>
  showGenericEmptyState: boolean
  normalizedFilter: string
  branchBaseRef: string | null
  filterTooLarge: boolean
  hasFilteredUncommittedEntries: boolean
  hasFilteredBranchEntries: boolean
  filterQuery: string
}): React.JSX.Element {
  return (
    <>
      {unresolvedConflictCount > 0 && (
        <div className="px-3 pb-2">
          <ConflictSummaryCard
            conflictOperation={conflictOperation}
            unresolvedCount={unresolvedConflictCount}
            sourceControlAiActionsVisible={sourceControlAiActionsVisible}
            isResolvingWithAI={false}
            isAbortingOperation={isAbortingOperation}
            onAbortOperation={onAbortOperation}
            onResolveWithAI={onResolveWithAi}
            onReview={onReviewConflicts}
          />
        </div>
      )}
      {/* Why: show the operation banner when a rebase/merge/cherry-pick is in progress with no unresolved conflicts. */}
      {unresolvedConflictCount === 0 && conflictOperation !== 'unknown' && (
        <div className="px-3 pb-2">
          <OperationBanner
            conflictOperation={conflictOperation}
            isAbortingOperation={isAbortingOperation}
            onAbortOperation={onAbortOperation}
          />
        </div>
      )}
      {repositoryHuge && (
        <div className="px-3 pb-2">
          {/* Why: a slow SSH retry must not keep the next worktree's Retry disabled after navigation. */}
          <TooManyChangesBanner
            key={worktreeId}
            limit={repositoryHuge.limit}
            onRetry={onRetryStatus}
          />
        </div>
      )}
      {showGenericEmptyState && !normalizedFilter ? (
        <EmptyState
          heading="No changes on this branch"
          supportingText={`This workspace is clean and this branch has no changes ahead of ${branchBaseRef ?? 'base'}`}
        />
      ) : null}
      {filterTooLarge && (
        <EmptyState
          heading="Search text is too large"
          supportingText="Use a shorter file filter."
        />
      )}
      {normalizedFilter && !hasFilteredUncommittedEntries && !hasFilteredBranchEntries && (
        <EmptyState
          heading="No matching files"
          supportingText={`No changed files match "${filterQuery}"`}
        />
      )}
    </>
  )
}
