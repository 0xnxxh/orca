import type { MobileWebTaskDetailComment } from '../../../src/shared/mobile-web/task-detail-contract'
import type { HostTaskItemMutationTarget } from './host-task-item-mutation-operations'

type GitHubTarget = Extract<HostTaskItemMutationTarget, { provider: 'github' }>
export type HostTaskReviewMergeMethod = 'merge' | 'squash' | 'rebase'

export type HostTaskItemReviewOperations = {
  addComment(
    target: HostTaskItemMutationTarget,
    body: string
  ): Promise<MobileWebTaskDetailComment | undefined>
  requestReviewers(target: GitHubTarget, reviewers: string[]): Promise<void>
  resolveThread(target: GitHubTarget, threadId: string, resolve: boolean): Promise<void>
  replyReviewComment(
    target: GitHubTarget,
    payload: {
      commentId: number
      body: string
      threadId?: string
      path?: string
      line?: number
    }
  ): Promise<void>
  merge(target: HostTaskItemMutationTarget, method: HostTaskReviewMergeMethod): Promise<void>
}
