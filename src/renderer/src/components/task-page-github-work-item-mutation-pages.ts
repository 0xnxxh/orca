import type { GitHubWorkItem } from '../../../shared/types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import { getRegistryMergedTaskPageGitHubWorkItem } from './task-page-github-work-item-mutation-composition'
import {
  hasConfirmedAuthorityForItem,
  hasPendingTaskPageGitHubOpsForItem,
  resolveItemSourceScope,
  taskPageGitHubItemKey
} from './task-page-github-work-item-mutation-registry'
import type { TaskPageGitHubPatchWorkItem } from './task-page-github-work-item-mutation-types'

/** Match each item to pending/confirmed authority by repoId + itemId + remembered sourceScope. */
export function applyPendingTaskPageGitHubMutationsToItems(
  items: readonly GitHubWorkItem[]
): GitHubWorkItem[] {
  return items.map((item) => {
    const sourceScope = resolveItemSourceScope(item.repoId, item.id)
    return getRegistryMergedTaskPageGitHubWorkItem(item, sourceScope)
  })
}

export function reapplyPendingTaskPageGitHubMutationsToCache(args: {
  items: readonly GitHubWorkItem[]
  patchWorkItem: TaskPageGitHubPatchWorkItem
  sourceContextByRepoId?: ReadonlyMap<string, TaskSourceContext | null | undefined>
}): void {
  for (const item of args.items) {
    const sourceScope = resolveItemSourceScope(item.repoId, item.id)
    const hasAuthority =
      hasPendingTaskPageGitHubOpsForItem(item.repoId, item.id) ||
      hasConfirmedAuthorityForItem(item.repoId, item.id)
    if (!hasAuthority) {
      continue
    }
    const merged = getRegistryMergedTaskPageGitHubWorkItem(item, sourceScope)
    args.patchWorkItem(
      item.id,
      {
        state: merged.state,
        assignees: merged.assignees,
        reviewRequests: merged.reviewRequests,
        autoMergeEnabled: merged.autoMergeEnabled
      },
      item.repoId,
      { sourceContext: args.sourceContextByRepoId?.get(item.repoId) }
    )
  }
}

/** Full-replace flat list: overlay + retain pending/confirmed-omitted rows (K18). */
export function materializeTaskPageItemList(args: {
  networkItems: readonly GitHubWorkItem[]
  previousItems: readonly GitHubWorkItem[]
  queryKey: string
}): GitHubWorkItem[] {
  void args.queryKey
  const overlaid = applyPendingTaskPageGitHubMutationsToItems(args.networkItems)
  const byKey = new Map(overlaid.map((item) => [taskPageGitHubItemKey(item.repoId, item.id), item]))
  for (const item of args.previousItems) {
    const k = taskPageGitHubItemKey(item.repoId, item.id)
    if (byKey.has(k)) {
      continue
    }
    // Why: retain in-flight pending rows for rollback visibility; also retain
    // confirmed-authority rows still soft-hidden while search lag omits them.
    if (
      !hasPendingTaskPageGitHubOpsForItem(item.repoId, item.id) &&
      !hasConfirmedAuthorityForItem(item.repoId, item.id)
    ) {
      continue
    }
    const scope = resolveItemSourceScope(item.repoId, item.id)
    byKey.set(k, getRegistryMergedTaskPageGitHubWorkItem(item, scope))
  }
  return [...byKey.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

/** In-place overlay per page; preserves multi-page structure; no retain. */
export function overlayPendingOnTaskPagePages(
  pages: readonly GitHubWorkItem[][]
): GitHubWorkItem[][] {
  return pages.map((page) => applyPendingTaskPageGitHubMutationsToItems(page))
}
