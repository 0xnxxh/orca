import type { GitHubWorkItem } from '../../../shared/types'
import {
  getTaskSourceCacheScope,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import { buildTaskPageGitHubWorkItemMutationPatch } from './task-page-github-work-item-mutation-patches'
import {
  getRegistryMergedTaskPageGitHubWorkItem,
  recomputeSoftHideForItem,
  rebuildSoftHiddenKeysFromPendingAndSticky,
  stripFamilyPendingFromList
} from './task-page-github-work-item-mutation-composition'
import {
  getConfirmedListSnapshot,
  getPendingTaskPageGitHubOp,
  getStickyHideEntry,
  listPendingTaskPageGitHubOpsForItem,
  nextTaskPageGitHubMutationGeneration,
  notifyTaskPageGitHubMutationRegistry,
  setConfirmedListSnapshot,
  setPendingTaskPageGitHubOp,
  setTaskPageGitHubMutationQueryKey,
  taskPageGitHubItemKey,
  type PendingOp,
  type TaskPageGitHubMutationKey
} from './task-page-github-work-item-mutation-registry'
import type {
  BeginTaskPageGitHubWorkItemMutationArgs,
  BeginTaskPageGitHubWorkItemMutationResult
} from './task-page-github-work-item-mutation-types'
import type { ParsedTaskQuery } from '../../../shared/task-query'

export type {
  BeginTaskPageGitHubWorkItemMutationArgs,
  BeginTaskPageGitHubWorkItemMutationResult,
  TaskPageGitHubPatchWorkItem
} from './task-page-github-work-item-mutation-types'

export {
  applyPendingTaskPageGitHubMutationsToItems,
  materializeTaskPageItemList,
  overlayPendingOnTaskPagePages,
  reapplyPendingTaskPageGitHubMutationsToCache
} from './task-page-github-work-item-mutation-pages'

export {
  adoptQuietSearchFieldsForItem,
  processTaskPageQuietRevalidateSettle,
  scheduleTaskPageQuietRevalidate,
  setTaskPageQuietRevalidateRunner,
  settleQuietSearchRevalidate,
  LAG_BACKOFF_MS,
  LAG_WALL_BUDGET_MS,
  MAX_LAG_TRAILS
} from './task-page-github-work-item-quiet-revalidate'

export {
  clearTaskPageGitHubConfirmedAuthority,
  resolveItemSourceScope
} from './task-page-github-work-item-mutation-registry'

export {
  confirmTaskPageGitHubWorkItemMutation,
  rollbackTaskPageGitHubWorkItemMutation
} from './task-page-github-work-item-mutation-lifecycle'

export { getRegistryMergedTaskPageGitHubWorkItem } from './task-page-github-work-item-mutation-composition'

export { setTaskPageGitHubMutationQueryKey, taskPageGitHubItemKey }

function resolveSourceScope(sourceContext?: TaskSourceContext | null): string | null {
  if (sourceContext?.provider === 'github') {
    return getTaskSourceCacheScope(sourceContext)
  }
  return null
}

export function beginTaskPageGitHubWorkItemMutation(
  args: BeginTaskPageGitHubWorkItemMutationArgs
): BeginTaskPageGitHubWorkItemMutationResult {
  setTaskPageGitHubMutationQueryKey(args.queryKey)
  const sourceScope = resolveSourceScope(args.sourceContext)
  const skipMeQualifiers = args.skipMeQualifiers ?? false
  const base = getRegistryMergedTaskPageGitHubWorkItem(args.item, sourceScope)
  const built = buildTaskPageGitHubWorkItemMutationPatch(base, args.intent)

  const key: TaskPageGitHubMutationKey = {
    sourceScope,
    repoId: args.item.repoId,
    itemId: args.item.id,
    opKey: built.opKey
  }
  const generation = nextTaskPageGitHubMutationGeneration(key)

  if (built.kind === 'list') {
    const existing = getConfirmedListSnapshot(
      sourceScope,
      args.item.repoId,
      args.item.id,
      built.family
    )
    if (!existing) {
      const ops = listPendingTaskPageGitHubOpsForItem(args.item.repoId, args.item.id, sourceScope)
      const snapshot = stripFamilyPendingFromList(args.item, built.family, ops)
      setConfirmedListSnapshot(sourceScope, args.item.repoId, args.item.id, built.family, snapshot)
    }
  }

  const op: PendingOp = {
    generation,
    key,
    previous: built.previous,
    next: built.next,
    listOp: built.kind === 'list' ? built.listOp : undefined,
    skipMeQualifiers,
    startedAt: Date.now()
  }
  setPendingTaskPageGitHubOp(op)

  const merged = getRegistryMergedTaskPageGitHubWorkItem(args.item, sourceScope)
  const composedFields: Partial<GitHubWorkItem> =
    built.kind === 'list'
      ? built.family === 'assignees'
        ? { assignees: merged.assignees }
        : { reviewRequests: merged.reviewRequests }
      : built.next

  args.patchWorkItem(args.item.id, composedFields, args.item.repoId, {
    sourceContext: args.sourceContext
  })

  recomputeSoftHideForItem({
    item: { ...args.item, ...merged },
    sourceScope,
    query: args.query,
    queryKey: args.queryKey,
    viewerLogin: args.viewerLogin,
    skipMeQualifiers,
    updateSticky: false
  })
  notifyTaskPageGitHubMutationRegistry()

  return {
    generation,
    opKey: built.opKey,
    itemKey: taskPageGitHubItemKey(args.item.repoId, args.item.id),
    key
  }
}

export function isTaskPageGitHubMutationPendingKey(key: TaskPageGitHubMutationKey): boolean {
  return getPendingTaskPageGitHubOp(key) !== undefined
}

export function getTaskPageGitHubStickyHideForTests(itemKey: string) {
  return getStickyHideEntry(itemKey)
}

export function rebuildSoftHiddenFromItemsForTests(args: {
  query: ParsedTaskQuery
  queryKey: string
  viewerLogin: string | null
  items: readonly GitHubWorkItem[]
}): void {
  rebuildSoftHiddenKeysFromPendingAndSticky(args)
}
