import type { GitHubWorkItem } from '../../../shared/types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import {
  adoptQuietSearchFieldsForItem,
  LAG_BACKOFF_MS,
  LAG_WALL_BUDGET_MS,
  MAX_LAG_TRAILS
} from './task-page-github-work-item-quiet-adopt'
import {
  gcStickyHidesAbsentFromPages,
  getAllStickyHideEntries,
  getOrCreateQuietRevalidateState,
  hasConfirmedAuthorityForItem,
  hasPendingTaskPageGitHubOpsForItem,
  notifyTaskPageGitHubMutationRegistry,
  resolveItemSourceScope,
  taskPageGitHubItemKey
} from './task-page-github-work-item-mutation-registry'
import type { TaskPageGitHubPatchWorkItem } from './task-page-github-work-item-mutation-types'

export { adoptQuietSearchFieldsForItem, MAX_LAG_TRAILS }

type QuietRunner = (queryKey: string) => Promise<readonly GitHubWorkItem[]>
let quietRunner: QuietRunner | null = null
export function setTaskPageQuietRevalidateRunner(runner: QuietRunner | null): void {
  quietRunner = runner
}
export function settleQuietSearchRevalidate(args: {
  queryKey: string
  networkItems: readonly GitHubWorkItem[]
  fetchStartedAtGeneration: number
  patchWorkItem: TaskPageGitHubPatchWorkItem
  resolveSourceScope?: (item: GitHubWorkItem) => string | null
  sourceContextByRepoId?: ReadonlyMap<string, TaskSourceContext | null | undefined>
}): { needTrailing: boolean } {
  let needTrailing = false
  for (const serverItem of args.networkItems) {
    const sourceScope =
      args.resolveSourceScope?.(serverItem) ??
      resolveItemSourceScope(serverItem.repoId, serverItem.id)
    const result = adoptQuietSearchFieldsForItem({
      item: serverItem,
      serverItem,
      sourceScope,
      queryKey: args.queryKey,
      fetchStartedAtGeneration: args.fetchStartedAtGeneration,
      patchWorkItem: args.patchWorkItem,
      sourceContext: args.sourceContextByRepoId?.get(serverItem.repoId)
    })
    if (result.needTrailing) {
      needTrailing = true
    }
  }
  // Why: do not GC sticky solely because search omitted a row under lag — that
  // would unhide a successful close under Open. Keep sticky for omitted rows
  // that still have pending or confirmed authority.
  const pageKeys = new Set(
    args.networkItems.map((item) => taskPageGitHubItemKey(item.repoId, item.id))
  )
  const safeGcKeys = new Set(pageKeys)
  for (const [itemKey] of getAllStickyHideEntries()) {
    if (pageKeys.has(itemKey)) {
      continue
    }
    const sep = itemKey.indexOf('\0')
    if (sep < 0) {
      continue
    }
    const repoId = itemKey.slice(0, sep)
    const itemId = itemKey.slice(sep + 1)
    if (
      hasPendingTaskPageGitHubOpsForItem(repoId, itemId) ||
      hasConfirmedAuthorityForItem(repoId, itemId)
    ) {
      safeGcKeys.add(itemKey)
    }
  }
  gcStickyHidesAbsentFromPages(safeGcKeys, args.queryKey)
  const quiet = getOrCreateQuietRevalidateState(args.queryKey)
  // Why: lag counters are aggregated with Math.max across the query, so an orphan
  // stuck at MAX (item lagged then left the result set) would disable lag-retry
  // for every row. Drop counters for items fully gone (no page/pending/authority).
  for (const lagKey of quiet.lagSkipAttempts.keys()) {
    const itemKey = lagKey.slice(0, lagKey.lastIndexOf('\0'))
    if (safeGcKeys.has(itemKey)) {
      continue
    }
    const sep = itemKey.indexOf('\0')
    if (sep < 0) {
      continue
    }
    if (
      !hasPendingTaskPageGitHubOpsForItem(itemKey.slice(0, sep), itemKey.slice(sep + 1)) &&
      !hasConfirmedAuthorityForItem(itemKey.slice(0, sep), itemKey.slice(sep + 1))
    ) {
      quiet.lagSkipAttempts.delete(lagKey)
    }
  }
  if (quiet.dirtyGeneration > args.fetchStartedAtGeneration) {
    needTrailing = true
  }
  notifyTaskPageGitHubMutationRegistry()
  return { needTrailing }
}
export async function scheduleTaskPageQuietRevalidate(queryKey: string): Promise<void> {
  const state = getOrCreateQuietRevalidateState(queryKey)
  if (state.inFlight || !quietRunner) {
    return
  }
  state.inFlight = true
  const runGeneration = state.dirtyGeneration
  state.fetchStartedAtGeneration = runGeneration
  try {
    await quietRunner(queryKey)
  } finally {
    state.inFlight = false
  }
  const after = getOrCreateQuietRevalidateState(queryKey)
  if (after.dirtyGeneration > runGeneration) {
    const lagValues = [...after.lagSkipAttempts.values()]
    const delay = LAG_BACKOFF_MS[Math.min(lagValues.length, LAG_BACKOFF_MS.length - 1)] ?? 500
    await new Promise((resolve) => setTimeout(resolve, delay))
    await scheduleTaskPageQuietRevalidate(queryKey)
  }
}
export async function processTaskPageQuietRevalidateSettle(args: {
  queryKey: string
  networkItems: readonly GitHubWorkItem[]
  patchWorkItem: TaskPageGitHubPatchWorkItem
  resolveSourceScope?: (item: GitHubWorkItem) => string | null
  sourceContextByRepoId?: ReadonlyMap<string, TaskSourceContext | null | undefined>
  scheduleTrailing?: boolean
}): Promise<{ needTrailing: boolean }> {
  const state = getOrCreateQuietRevalidateState(args.queryKey)
  const G0 = state.fetchStartedAtGeneration
  const result = settleQuietSearchRevalidate({
    queryKey: args.queryKey,
    networkItems: args.networkItems,
    fetchStartedAtGeneration: G0,
    patchWorkItem: args.patchWorkItem,
    resolveSourceScope: args.resolveSourceScope,
    sourceContextByRepoId: args.sourceContextByRepoId
  })
  if (result.needTrailing && args.scheduleTrailing !== false) {
    const lagValues = [...state.lagSkipAttempts.values()]
    const attempts = lagValues.length === 0 ? 0 : Math.max(...lagValues)
    const wallExceeded = Date.now() - state.lastConfirmAt > LAG_WALL_BUDGET_MS
    if (attempts < MAX_LAG_TRAILS && !wallExceeded) {
      const delay = LAG_BACKOFF_MS[Math.min(attempts, LAG_BACKOFF_MS.length - 1)] ?? 500
      await new Promise((resolve) => setTimeout(resolve, delay))
      await scheduleTaskPageQuietRevalidate(args.queryKey)
    }
  }
  return result
}
