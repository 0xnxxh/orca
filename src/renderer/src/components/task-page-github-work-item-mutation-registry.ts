import type { GitHubAssignableUser, GitHubWorkItem } from '../../../shared/types'
/** Whole-field replace keys (single RPC / single superseding generation). */
export type TaskPageGitHubWholeField = 'state' | 'merge' | 'autoMerge'
/**
 * Op-keyed list families: each independent login RPC gets its own generation.
 * Serialized as `assignees:${loginLower}` / `reviewRequests:${loginLower}`.
 */
export type TaskPageGitHubListFamily = 'assignees' | 'reviewRequests'
export type TaskPageGitHubMutationKey = {
  sourceScope: string | null
  repoId: string
  itemId: string
  /** e.g. 'state' | 'merge' | 'autoMerge' | 'assignees:alice' | 'reviewRequests:bob' */
  opKey: string
}
export type PendingListOp = {
  family: TaskPageGitHubListFamily
  kind: 'add' | 'remove'
  /** Length 1 for per-login; N for atomic multi-login batch. */
  logins: string[]
  users?: GitHubAssignableUser[]
}
export type PendingOp = {
  generation: number
  key: TaskPageGitHubMutationKey
  previous: Partial<GitHubWorkItem>
  next: Partial<GitHubWorkItem>
  listOp?: PendingListOp
  /** Frozen at begin for soft-hide recompute on confirm/rollback (K20). */
  skipMeQualifiers: boolean
  startedAt: number
}
export type StickyHideEntry = {
  itemKey: string
  sourceScope: string | null
  queryKey: string
  reason: 'filter_membership'
}
export type QuietRevalidateState = {
  inFlight: boolean
  /** Set when a quiet run is requested while another is in flight. */
  trailingQueued: boolean
  dirtyGeneration: number
  fetchStartedAtGeneration: number
  familyDirtyAt: Map<string, number>
  lagSkipAttempts: Map<string, number>
  lastConfirmAt: number
}
import {
  serializeTaskPageGitHubMutationKey,
  taskPageGitHubItemKey,
  taskPageGitHubLastConfirmedKey,
  taskPageGitHubSnapshotKey
} from './task-page-github-work-item-mutation-keys'
export {
  serializeTaskPageGitHubMutationKey,
  taskPageGitHubFamilyDirtyKey,
  taskPageGitHubItemKey,
  taskPageGitHubLastConfirmedKey,
  taskPageGitHubListOpKey,
  taskPageGitHubSnapshotKey
} from './task-page-github-work-item-mutation-keys'
type Listener = () => void
const listeners = new Set<Listener>()
const pendingByKey = new Map<string, PendingOp>()
const generations = new Map<string, number>()
const confirmedSnapshots = new Map<string, GitHubAssignableUser[]>()
const lastConfirmedClientValues = new Map<string, unknown>()
/**
 * Why: after confirm, pending ops are gone but lastConfirmed/snapshots stay keyed
 * by sourceScope. Overlay must still resolve the same scope or authority is lost.
 */
const itemSourceScopeByItemKey = new Map<string, string | null>()
const stickyHideByItemKey = new Map<string, StickyHideEntry>()
const softHiddenItemKeys = new Set<string>()
const quietByQueryKey = new Map<string, QuietRevalidateState>()
let mutationQueryKey: string | null = null
export function subscribeTaskPageGitHubMutationRegistry(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function notifyTaskPageGitHubMutationRegistry(): void {
  for (const listener of listeners) {
    listener()
  }
}
export function getTaskPageGitHubSoftHiddenItemKeys(): ReadonlySet<string> {
  return softHiddenItemKeys
}
/**
 * Drop confirmed-client authority (not in-flight pending). Used when the user
 * hard-refreshes so search can adopt for non-pending families (design tier 3).
 */
export function clearTaskPageGitHubConfirmedAuthority(): void {
  confirmedSnapshots.clear()
  lastConfirmedClientValues.clear()
  itemSourceScopeByItemKey.clear()
}

/**
 * Sticky hides + confirmed authority are query-scoped. Changing query/repo set
 * clears them so a new filter does not inherit membership exits / lastConfirmed
 * from a previous search.
 */
export function setTaskPageGitHubMutationQueryKey(queryKey: string): void {
  if (mutationQueryKey === queryKey) {
    return
  }
  mutationQueryKey = queryKey
  stickyHideByItemKey.clear()
  softHiddenItemKeys.clear()
  // Why: lastConfirmed is for lag hold within one query; a new search should
  // not permanently override rows with the previous filter's mutations.
  clearTaskPageGitHubConfirmedAuthority()
  // Why: bound growth — quiet lag/dirty state and generation counters accumulate
  // per queryKey/opKey over a session. A new query starts fresh, so drop the old
  // quiet states and any generation counters with no in-flight pending op (keys
  // with a live op must keep their counter so staleness detection stays valid).
  quietByQueryKey.clear()
  for (const serialized of generations.keys()) {
    if (!pendingByKey.has(serialized)) {
      generations.delete(serialized)
    }
  }
  notifyTaskPageGitHubMutationRegistry()
}
export function getPendingTaskPageGitHubOp(key: TaskPageGitHubMutationKey): PendingOp | undefined {
  return pendingByKey.get(serializeTaskPageGitHubMutationKey(key))
}
export function nextTaskPageGitHubMutationGeneration(key: TaskPageGitHubMutationKey): number {
  const serialized = serializeTaskPageGitHubMutationKey(key)
  const next = (generations.get(serialized) ?? 0) + 1
  generations.set(serialized, next)
  return next
}
export function setPendingTaskPageGitHubOp(op: PendingOp): void {
  const serialized = serializeTaskPageGitHubMutationKey(op.key)
  // Why: whole-field supersede abandons older pending without rollback; list
  // ops share the same map entry only when opKey matches (per-login / batch).
  pendingByKey.set(serialized, op)
  rememberItemSourceScope(op.key.repoId, op.key.itemId, op.key.sourceScope)
}

export function rememberItemSourceScope(
  repoId: string,
  itemId: string,
  sourceScope: string | null
): void {
  itemSourceScopeByItemKey.set(taskPageGitHubItemKey(repoId, itemId), sourceScope)
}

/**
 * Resolve the sourceScope used for lastConfirmed/snapshot lookups for an item.
 * Prefer live pending, then the remembered scope from the last begin/confirm.
 */
export function resolveItemSourceScope(repoId: string, itemId: string): string | null {
  const fromPending = getSourceScopeFromPendingOps(repoId, itemId)
  if (fromPending !== undefined) {
    return fromPending
  }
  const remembered = itemSourceScopeByItemKey.get(taskPageGitHubItemKey(repoId, itemId))
  return remembered !== undefined ? remembered : null
}

export function hasConfirmedAuthorityForItem(repoId: string, itemId: string): boolean {
  const sourceScope = resolveItemSourceScope(repoId, itemId)
  return (
    getConfirmedListSnapshot(sourceScope, repoId, itemId, 'assignees') !== undefined ||
    getConfirmedListSnapshot(sourceScope, repoId, itemId, 'reviewRequests') !== undefined ||
    getLastConfirmedClientValue(sourceScope, repoId, itemId, 'state') !== undefined ||
    getLastConfirmedClientValue(sourceScope, repoId, itemId, 'autoMerge') !== undefined
  )
}
export function deletePendingTaskPageGitHubOp(
  key: TaskPageGitHubMutationKey
): PendingOp | undefined {
  const serialized = serializeTaskPageGitHubMutationKey(key)
  const existing = pendingByKey.get(serialized)
  if (existing) {
    pendingByKey.delete(serialized)
  }
  return existing
}
export function listPendingTaskPageGitHubOpsForItem(
  repoId: string,
  itemId: string,
  sourceScope?: string | null
): PendingOp[] {
  const ops: PendingOp[] = []
  for (const op of pendingByKey.values()) {
    if (op.key.repoId !== repoId || op.key.itemId !== itemId) {
      continue
    }
    if (sourceScope !== undefined && op.key.sourceScope !== sourceScope) {
      continue
    }
    ops.push(op)
  }
  return ops.sort((a, b) => a.startedAt - b.startedAt)
}
export function hasPendingTaskPageGitHubOpsForItem(repoId: string, itemId: string): boolean {
  for (const op of pendingByKey.values()) {
    if (op.key.repoId === repoId && op.key.itemId === itemId) {
      return true
    }
  }
  return false
}
export function getSourceScopeFromPendingOps(
  repoId: string,
  itemId: string
): string | null | undefined {
  for (const op of pendingByKey.values()) {
    if (op.key.repoId === repoId && op.key.itemId === itemId) {
      return op.key.sourceScope
    }
  }
  return undefined
}
export function getConfirmedListSnapshot(
  sourceScope: string | null,
  repoId: string,
  itemId: string,
  family: TaskPageGitHubListFamily
): GitHubAssignableUser[] | undefined {
  return confirmedSnapshots.get(taskPageGitHubSnapshotKey(sourceScope, repoId, itemId, family))
}
export function setConfirmedListSnapshot(
  sourceScope: string | null,
  repoId: string,
  itemId: string,
  family: TaskPageGitHubListFamily,
  users: readonly GitHubAssignableUser[]
): void {
  rememberItemSourceScope(repoId, itemId, sourceScope)
  confirmedSnapshots.set(taskPageGitHubSnapshotKey(sourceScope, repoId, itemId, family), [...users])
}
export function getLastConfirmedClientValue(
  sourceScope: string | null,
  repoId: string,
  itemId: string,
  family: string
): unknown {
  return lastConfirmedClientValues.get(
    taskPageGitHubLastConfirmedKey(sourceScope, repoId, itemId, family)
  )
}
export function setLastConfirmedClientValue(
  sourceScope: string | null,
  repoId: string,
  itemId: string,
  family: string,
  value: unknown
): void {
  rememberItemSourceScope(repoId, itemId, sourceScope)
  lastConfirmedClientValues.set(
    taskPageGitHubLastConfirmedKey(sourceScope, repoId, itemId, family),
    value
  )
}
export function getStickyHideEntry(itemKey: string): StickyHideEntry | undefined {
  return stickyHideByItemKey.get(itemKey)
}
export function setStickyHideEntry(entry: StickyHideEntry): void {
  stickyHideByItemKey.set(entry.itemKey, entry)
}
export function deleteStickyHideEntry(itemKey: string): void {
  stickyHideByItemKey.delete(itemKey)
}
export function clearAllStickyHideEntries(): void {
  stickyHideByItemKey.clear()
}
export function getAllStickyHideEntries(): ReadonlyMap<string, StickyHideEntry> {
  return stickyHideByItemKey
}
export function setSoftHiddenItemKeys(keys: Iterable<string>): void {
  softHiddenItemKeys.clear()
  for (const key of keys) {
    softHiddenItemKeys.add(key)
  }
}
export function updateSoftHiddenItemKey(itemKey: string, hide: boolean): void {
  if (hide) {
    softHiddenItemKeys.add(itemKey)
  } else {
    softHiddenItemKeys.delete(itemKey)
  }
}
export function getOrCreateQuietRevalidateState(queryKey: string): QuietRevalidateState {
  let state = quietByQueryKey.get(queryKey)
  if (!state) {
    state = {
      inFlight: false,
      trailingQueued: false,
      dirtyGeneration: 0,
      fetchStartedAtGeneration: 0,
      familyDirtyAt: new Map(),
      lagSkipAttempts: new Map(),
      lastConfirmAt: 0
    }
    quietByQueryKey.set(queryKey, state)
  }
  return state
}
export function gcStickyHidesAbsentFromPages(
  pageItemKeys: ReadonlySet<string>,
  queryKey: string
): void {
  for (const [itemKey, entry] of stickyHideByItemKey) {
    if (entry.queryKey !== queryKey) {
      continue
    }
    if (!pageItemKeys.has(itemKey)) {
      stickyHideByItemKey.delete(itemKey)
      softHiddenItemKeys.delete(itemKey)
    }
  }
}
/** Test-only: wipe module state between unit cases. */
export function resetTaskPageGitHubMutationRegistryForTests(): void {
  pendingByKey.clear()
  generations.clear()
  confirmedSnapshots.clear()
  lastConfirmedClientValues.clear()
  itemSourceScopeByItemKey.clear()
  stickyHideByItemKey.clear()
  softHiddenItemKeys.clear()
  quietByQueryKey.clear()
  mutationQueryKey = null
  listeners.clear()
}
