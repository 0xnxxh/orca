import { branchName } from '@/lib/git-utils'
import { getGitHubPRCacheKey } from '@/store/slices/github-cache-key'
import { getHostedReviewCacheKey } from '@/store/slices/hosted-review-cache-identity'
import type { AppState } from '@/store/types'
import type { DashboardCardReview } from '../../../../shared/dashboard-snapshot'
import { isPositiveHostedReviewNumber } from '../../../../shared/hosted-review'
import type { Repo, Worktree, WorkspaceStatusDefinition } from '../../../../shared/types'
import {
  DEFAULT_WORKSPACE_STATUSES,
  getWorkspaceStatus
} from '../../../../shared/workspace-statuses'
import { selectChecksPanelReview } from '../right-sidebar/checks-panel-review'

export type DashboardCardContextState = Partial<
  Pick<AppState, 'hostedReviewCache' | 'prCache' | 'settings' | 'workspaceStatuses'>
>

export type DashboardCardContext = {
  workspaceStatus: WorkspaceStatusDefinition
  hasReview: boolean
  review?: DashboardCardReview
}

function hasLinkedReview(worktree: Worktree): boolean {
  return [
    worktree.linkedPR,
    worktree.linkedGitLabMR,
    worktree.linkedBitbucketPR,
    worktree.linkedAzureDevOpsPR,
    worktree.linkedGiteaPR
  ].some(isPositiveHostedReviewNumber)
}

function resolveReview(
  state: DashboardCardContextState,
  repo: Repo,
  worktree: Worktree
): DashboardCardReview | undefined {
  if (!state.hostedReviewCache || !state.prCache || repo.kind === 'folder') {
    return undefined
  }
  const branch = branchName(worktree.branch)
  const keyArgs = [
    repo.path,
    repo.id,
    branch,
    state.settings,
    repo.connectionId,
    repo.executionHostId,
    true
  ] as const
  const review = selectChecksPanelReview({
    hostedReview:
      state.hostedReviewCache[
        getHostedReviewCacheKey(
          repo.path,
          branch,
          state.settings,
          repo.id,
          repo.connectionId,
          repo.executionHostId,
          true
        )
      ]?.data,
    pr: state.prCache[getGitHubPRCacheKey(...keyArgs)]?.data,
    linkedGitLabMR: worktree.linkedGitLabMR ?? null,
    linkedBitbucketPR: worktree.linkedBitbucketPR ?? null,
    linkedAzureDevOpsPR: worktree.linkedAzureDevOpsPR ?? null,
    linkedGiteaPR: worktree.linkedGiteaPR ?? null
  })
  return review ? { number: review.number, state: review.state } : undefined
}

export function resolveDashboardCardContext(
  state: DashboardCardContextState,
  repo: Repo,
  worktree: Worktree
): DashboardCardContext {
  const statuses =
    state.workspaceStatuses && state.workspaceStatuses.length > 0
      ? state.workspaceStatuses
      : DEFAULT_WORKSPACE_STATUSES
  const workspaceStatusId = getWorkspaceStatus(worktree, statuses)
  return {
    workspaceStatus:
      statuses.find((status) => status.id === workspaceStatusId) ?? DEFAULT_WORKSPACE_STATUSES[0],
    review: resolveReview(state, repo, worktree),
    hasReview: hasLinkedReview(worktree)
  }
}
