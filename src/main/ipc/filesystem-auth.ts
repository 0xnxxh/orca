/* eslint-disable max-lines -- Why: keeps the filesystem-auth security boundary auditable end to end. */
import { resolve, relative, dirname, basename, isAbsolute, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import type { Store } from '../persistence'
import { isRepoRoot, listRepoWorktrees } from '../repo-worktrees'
import { computeWorkspaceRoot, getWorktreePathSettings } from './worktree-logic'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import {
  buildProjectGroupOwnerIndex,
  getProjectGroupOwnerHostId,
  resolveFolderWorkspaceProjectGroup
} from '../../shared/project-groups'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId
} from '../../shared/execution-host'
import type { FolderWorkspace, ProjectGroup, Repo } from '../../shared/types'
import {
  resolveFolderWorkspaceCatalogOwnerHostIdFromIndex,
  resolveFolderWorkspaceProjectGroupWithLegacySsh
} from '../../shared/folder-workspaces'

export const PATH_ACCESS_DENIED_MESSAGE =
  'Access denied: path resolves outside allowed directories. If this blocks a legitimate workflow, please file a GitHub issue.'
// Why: authorized external paths accumulate all session; LRU-bound the set. Safe to evict because every caller re-authorizes before operating.
export const AUTHORIZED_EXTERNAL_PATHS_MAX = 4096
const authorizedExternalPaths = new Set<string>()
const registeredWorktreeRoots = new Set<string>()
const registeredWorktreeRootsByRepo = new Map<string, Set<string>>()
const registeredWorktreeRootRepoIds = new Set<string>()
let registeredWorktreeRootsDirty = true
let registeredWorktreeRootsRefresh: Promise<void> | null = null
const AUTHORIZED_ROOTS_REBUILD_CONCURRENCY = 8
type FolderScopeStore = Pick<Store, 'getRepos'> &
  Partial<Pick<Store, 'getProjectGroups' | 'getFolderWorkspaces'>>

function rememberAuthorizedExternalPath(path: string): void {
  // Delete-then-add makes re-authorized paths most-recent so LRU eviction sheds only the oldest untouched entries.
  authorizedExternalPaths.delete(path)
  authorizedExternalPaths.add(path)
  while (authorizedExternalPaths.size > AUTHORIZED_EXTERNAL_PATHS_MAX) {
    const oldest = authorizedExternalPaths.keys().next().value
    if (oldest === undefined) {
      break
    }
    authorizedExternalPaths.delete(oldest)
  }
}

export function authorizeExternalPath(targetPath: string): void {
  const resolvedTarget = resolve(targetPath)
  rememberAuthorizedExternalPath(resolvedTarget)
  try {
    // Why: macOS canonicalizes /tmp to /private/tmp during read authorization.
    rememberAuthorizedExternalPath(realpathSync(resolvedTarget))
  } catch {}
}

export function invalidateAuthorizedRootsCache(): void {
  registeredWorktreeRootsDirty = true
  // Why: dirty roots can't be trusted for auth short-circuits; fresh worktrees:list seeds safe per-repo roots before a full rebuild.
  registeredWorktreeRoots.clear()
  registeredWorktreeRootsByRepo.clear()
  registeredWorktreeRootRepoIds.clear()
}

function getLocalRepos(store: Store) {
  // Why: SSH repo paths are remote-host paths; treating them as local roots could authorize unrelated local folders or probe SSH-only paths.
  return store
    .getRepos()
    .filter(
      (repo) => !repo.connectionId && getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID
    )
}

type FolderAuthIndex = {
  projectGroupIndex: ReturnType<typeof buildProjectGroupOwnerIndex>
  groupMembership: ReadonlyMap<string, GroupMembershipSummary>
  legacyGroupMembership: ReadonlyMap<string, GroupMembershipSummary>
  allRepoPaths: readonly string[]
  localOwnerRepoPaths: readonly string[]
  unconnectedRepoPathsByOwner: ReadonlyMap<string, readonly string[]>
}

type GroupMembershipSummary = {
  repoCount: number
  folderWorkspaceCount: number
  hasLocalOwner: boolean
  hasLocalFolderWorkspace: boolean
  hasUnconnectedRepo: boolean
  unsafeCycle: boolean
}

function ownerGroupKey(ownerHostId: string, groupId: string): string {
  return `${ownerHostId}\0${groupId}`
}

function buildFolderAuthIndex(
  projectGroups: readonly ProjectGroup[],
  repos: readonly Repo[],
  folderWorkspaces: readonly FolderWorkspace[]
): FolderAuthIndex {
  const projectGroupIndex = buildProjectGroupOwnerIndex(projectGroups)
  const parentByGroup = new Map<string, string>()
  const remainingChildren = new Map<string, number>()
  const groupMembership = new Map<string, GroupMembershipSummary>()
  const legacyParentsByGroup = new Map<string, Set<string>>()
  const legacyChildrenByGroup = new Map<string, Set<string>>()
  const legacyGroupMembership = new Map<string, GroupMembershipSummary>()
  for (const group of projectGroups) {
    const ownerHostId = getProjectGroupOwnerHostId(group)
    const key = ownerGroupKey(ownerHostId, group.id)
    remainingChildren.set(key, 0)
    groupMembership.set(key, emptyGroupMembershipSummary())
    if (!legacyGroupMembership.has(group.id)) {
      legacyGroupMembership.set(group.id, emptyGroupMembershipSummary())
    }
    if (group.parentGroupId) {
      const parents = legacyParentsByGroup.get(group.id) ?? new Set<string>()
      parents.add(group.parentGroupId)
      legacyParentsByGroup.set(group.id, parents)
      const children = legacyChildrenByGroup.get(group.parentGroupId) ?? new Set<string>()
      children.add(group.id)
      legacyChildrenByGroup.set(group.parentGroupId, children)
    }
  }
  for (const group of projectGroups) {
    if (!group.parentGroupId) {
      continue
    }
    const ownerHostId = getProjectGroupOwnerHostId(group)
    const key = ownerGroupKey(ownerHostId, group.id)
    const parentKey = ownerGroupKey(ownerHostId, group.parentGroupId)
    if (remainingChildren.has(parentKey)) {
      parentByGroup.set(key, parentKey)
      remainingChildren.set(parentKey, (remainingChildren.get(parentKey) ?? 0) + 1)
    }
  }

  const allRepoPaths: string[] = []
  const localOwnerRepoPaths: string[] = []
  const unconnectedRepoPathsByOwner = new Map<string, string[]>()
  for (const repo of repos) {
    const ownerHostId = getRepoExecutionHostId(repo)
    const normalizedPath = normalizeRuntimePathForComparison(repo.path)
    allRepoPaths.push(normalizedPath)
    if (ownerHostId === LOCAL_EXECUTION_HOST_ID) {
      localOwnerRepoPaths.push(normalizedPath)
    }
    if (!repo.connectionId) {
      const ownerPaths = unconnectedRepoPathsByOwner.get(ownerHostId) ?? []
      ownerPaths.push(normalizedPath)
      unconnectedRepoPathsByOwner.set(ownerHostId, ownerPaths)
    }
    if (typeof repo.projectGroupId === 'string') {
      const key = ownerGroupKey(ownerHostId, repo.projectGroupId)
      const summary = groupMembership.get(key)
      if (summary) {
        summary.repoCount++
        summary.hasLocalOwner ||= ownerHostId === LOCAL_EXECUTION_HOST_ID
        summary.hasUnconnectedRepo ||= !repo.connectionId
      }
      const legacySummary = legacyGroupMembership.get(repo.projectGroupId)
      if (legacySummary) {
        legacySummary.repoCount++
        legacySummary.hasLocalOwner ||= ownerHostId === LOCAL_EXECUTION_HOST_ID
        legacySummary.hasUnconnectedRepo ||= !repo.connectionId
      }
    }
  }
  for (const workspace of folderWorkspaces) {
    if (
      workspace.connectionId === undefined &&
      !normalizeExecutionHostId(workspace.executionHostId)
    ) {
      continue
    }
    const group = resolveFolderWorkspaceProjectGroupWithLegacySsh(projectGroupIndex, workspace)
    if (!group) {
      continue
    }
    const ownerHostId = resolveFolderWorkspaceCatalogOwnerHostIdFromIndex(
      workspace,
      projectGroupIndex
    )
    const summary = groupMembership.get(ownerGroupKey(getProjectGroupOwnerHostId(group), group.id))
    if (summary) {
      summary.folderWorkspaceCount++
      summary.hasLocalFolderWorkspace ||= ownerHostId === LOCAL_EXECUTION_HOST_ID
    }
    const legacySummary = legacyGroupMembership.get(group.id)
    if (legacySummary) {
      legacySummary.folderWorkspaceCount++
      legacySummary.hasLocalFolderWorkspace ||= ownerHostId === LOCAL_EXECUTION_HOST_ID
    }
  }

  const pending = [...remainingChildren]
    .filter(([, childCount]) => childCount === 0)
    .map(([key]) => key)
  let processed = 0
  while (pending.length > 0) {
    const key = pending.pop()!
    processed++
    const parentKey = parentByGroup.get(key)
    if (!parentKey) {
      continue
    }
    mergeGroupMembership(groupMembership.get(parentKey)!, groupMembership.get(key)!)
    const nextChildCount = (remainingChildren.get(parentKey) ?? 1) - 1
    remainingChildren.set(parentKey, nextChildCount)
    if (nextChildCount === 0) {
      pending.push(parentKey)
    }
  }
  if (processed !== groupMembership.size) {
    for (const [key, childCount] of remainingChildren) {
      if (childCount > 0) {
        groupMembership.get(key)!.unsafeCycle = true
      }
    }
  }

  const legacyRemainingChildren = new Map(
    [...legacyGroupMembership.keys()].map((groupId) => [
      groupId,
      legacyChildrenByGroup.get(groupId)?.size ?? 0
    ])
  )
  const legacyPending = [...legacyRemainingChildren]
    .filter(([, childCount]) => childCount === 0)
    .map(([groupId]) => groupId)
  let legacyProcessed = 0
  while (legacyPending.length > 0) {
    const groupId = legacyPending.pop()!
    legacyProcessed++
    for (const parentId of legacyParentsByGroup.get(groupId) ?? []) {
      const parentSummary = legacyGroupMembership.get(parentId)
      if (!parentSummary) {
        continue
      }
      mergeGroupMembership(parentSummary, legacyGroupMembership.get(groupId)!)
      const nextChildCount = (legacyRemainingChildren.get(parentId) ?? 1) - 1
      legacyRemainingChildren.set(parentId, nextChildCount)
      if (nextChildCount === 0) {
        legacyPending.push(parentId)
      }
    }
  }
  if (legacyProcessed !== legacyGroupMembership.size) {
    for (const [groupId, childCount] of legacyRemainingChildren) {
      if (childCount > 0) {
        legacyGroupMembership.get(groupId)!.unsafeCycle = true
      }
    }
  }

  allRepoPaths.sort()
  localOwnerRepoPaths.sort()
  for (const paths of unconnectedRepoPathsByOwner.values()) {
    paths.sort()
  }
  return {
    projectGroupIndex,
    groupMembership,
    legacyGroupMembership,
    allRepoPaths,
    localOwnerRepoPaths,
    unconnectedRepoPathsByOwner
  }
}

function emptyGroupMembershipSummary(): GroupMembershipSummary {
  return {
    repoCount: 0,
    folderWorkspaceCount: 0,
    hasLocalOwner: false,
    hasLocalFolderWorkspace: false,
    hasUnconnectedRepo: false,
    unsafeCycle: false
  }
}

function mergeGroupMembership(target: GroupMembershipSummary, child: GroupMembershipSummary): void {
  target.repoCount += child.repoCount
  target.folderWorkspaceCount += child.folderWorkspaceCount
  target.hasLocalOwner ||= child.hasLocalOwner
  target.hasLocalFolderWorkspace ||= child.hasLocalFolderWorkspace
  target.hasUnconnectedRepo ||= child.hasUnconnectedRepo
  target.unsafeCycle ||= child.unsafeCycle
}

function hasIndexedPathInside(rootPath: string, sortedPaths: readonly string[]): boolean {
  const root = normalizeRuntimePathForComparison(rootPath)
  const prefix = root === '/' || /^[a-z]:\/$/i.test(root) ? root : `${root}/`
  const lowerBound = (needle: string): number => {
    let low = 0
    let high = sortedPaths.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (sortedPaths[middle] < needle) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return low
  }
  if (sortedPaths[lowerBound(root)] === root) {
    return true
  }
  return Boolean(sortedPaths[lowerBound(prefix)]?.startsWith(prefix))
}

function isRemoteOnlyFolderScopeWithIndex(
  index: FolderAuthIndex,
  folderPath: string,
  projectGroupId: string,
  ownerHostId: string,
  inferLegacyOwner: boolean
): boolean {
  if (ownerHostId !== LOCAL_EXECUTION_HOST_ID) {
    return true
  }
  const summary =
    index.groupMembership.get(ownerGroupKey(ownerHostId, projectGroupId)) ??
    emptyGroupMembershipSummary()
  if (summary.unsafeCycle) {
    return true
  }
  if (inferLegacyOwner) {
    const legacySummary =
      index.legacyGroupMembership.get(projectGroupId) ?? emptyGroupMembershipSummary()
    if (legacySummary.unsafeCycle) {
      return true
    }
    const hasAnyCandidate =
      legacySummary.repoCount > 0 ||
      legacySummary.folderWorkspaceCount > 0 ||
      hasIndexedPathInside(folderPath, index.allRepoPaths)
    const hasLocalCandidate =
      legacySummary.hasLocalOwner ||
      legacySummary.hasLocalFolderWorkspace ||
      hasIndexedPathInside(folderPath, index.localOwnerRepoPaths)
    if (hasAnyCandidate && !hasLocalCandidate) {
      return true
    }
  }
  if (summary.repoCount === 0 && summary.folderWorkspaceCount === 0) {
    // Why: empty membership means no remote-linked evidence; authorize local folder scopes without path scans.
    return false
  }
  if (summary.hasUnconnectedRepo || summary.hasLocalFolderWorkspace) {
    return false
  }
  if (hasIndexedPathInside(folderPath, index.unconnectedRepoPathsByOwner.get(ownerHostId) ?? [])) {
    return false
  }
  return true
}

function getLocalFolderScopeRoots(store: Store): string[] {
  const scopeStore = store as FolderScopeStore
  const repos = scopeStore.getRepos()
  // Why: many filesystem tests use narrow Store doubles; folder scopes are additive.
  const projectGroups = scopeStore.getProjectGroups?.() ?? []
  const folderWorkspaces = scopeStore.getFolderWorkspaces?.() ?? []
  // Why: one owner-indexed pass avoids O((groups+folders)*(groups+repos)) remote-only checks.
  const index = buildFolderAuthIndex(projectGroups, repos, folderWorkspaces)
  const roots: string[] = []
  for (const group of projectGroups) {
    if (
      group.parentPath &&
      !isRemoteOnlyFolderScopeWithIndex(
        index,
        group.parentPath,
        group.id,
        getProjectGroupOwnerHostId(group),
        group.connectionId === undefined &&
          group.executionHostId === undefined &&
          index.projectGroupIndex.byId.get(group.id)?.length === 1
      )
    ) {
      roots.push(resolve(group.parentPath))
    }
  }
  for (const workspace of folderWorkspaces) {
    const group = resolveFolderWorkspaceProjectGroup(index.projectGroupIndex, workspace)
    if (!group && index.projectGroupIndex.byId.has(workspace.projectGroupId)) {
      continue
    }
    // Why: narrow Store doubles may omit groups; folder roots stay additive from the workspace catalog.
    const ownerHostId = group
      ? getProjectGroupOwnerHostId(group)
      : resolveFolderWorkspaceCatalogOwnerHostIdFromIndex(workspace, index.projectGroupIndex)
    if (!ownerHostId) {
      continue
    }
    if (
      !isRemoteOnlyFolderScopeWithIndex(
        index,
        workspace.folderPath,
        workspace.projectGroupId,
        ownerHostId,
        workspace.connectionId === undefined &&
          workspace.executionHostId === undefined &&
          index.projectGroupIndex.byId.get(workspace.projectGroupId)?.length === 1
      )
    ) {
      roots.push(resolve(workspace.folderPath))
    }
  }
  return roots
}

/**
 * Check whether resolvedTarget is equal to or a descendant of resolvedBase.
 * Uses relative() so it works with both `/` (Unix) and `\` (Windows) separators.
 */
export function isDescendantOrEqual(resolvedTarget: string, resolvedBase: string): boolean {
  if (resolvedTarget === resolvedBase) {
    return true
  }
  const rel = relative(resolvedBase, resolvedTarget)
  // Security: reject "..", "../…" or an absolute rel — on Windows relative() returns absolute across drives, which would bypass drive-traversal checks.
  // Use isAbsolute, not rejoin+compare: Windows path.relative() ignores drive/root casing, so rejoining would deny valid c:\repo under C:\Repo.
  return rel !== '' && !(rel === '..' || rel.startsWith(`..${sep}`)) && !isAbsolute(rel)
}

export function getAllowedRoots(store: Store): string[] {
  const localRepos = getLocalRepos(store)
  const settings = store.getSettings()
  const roots = [
    ...localRepos.map((repo) => resolve(repo.path)),
    ...getLocalFolderScopeRoots(store)
  ]
  if (settings.workspaceDir) {
    if (localRepos.length === 0) {
      roots.push(resolve(settings.workspaceDir))
    } else {
      for (const repo of localRepos) {
        roots.push(
          resolve(computeWorkspaceRoot(repo.path, getWorktreePathSettings(repo, settings)))
        )
      }
    }
  }
  return roots
}

export function isPathAllowed(targetPath: string, store: Store): boolean {
  const resolvedTarget = resolve(targetPath)
  if (authorizedExternalPaths.has(resolvedTarget)) {
    return true
  }
  for (const authorizedPath of authorizedExternalPaths) {
    if (isDescendantOrEqual(resolvedTarget, authorizedPath)) {
      return true
    }
  }
  return getAllowedRoots(store).some((root) => isDescendantOrEqual(resolvedTarget, root))
}

export async function rebuildAuthorizedRootsCache(store: Store): Promise<void> {
  // Why: bounded parallelism keeps the Windows speedup without one git process per repo.
  // Why no realpath here: canonicalizing every root on invalidation would trigger macOS TCC prompts; handlers still canonicalize the target before any operation.
  const repos = getLocalRepos(store)
  const perProjectResults = await mapWithConcurrency(
    repos,
    AUTHORIZED_ROOTS_REBUILD_CONCURRENCY,
    async (repo) => {
      const roots: string[] = []
      try {
        roots.push(resolve(repo.path))

        for (const worktree of await listRepoWorktrees(repo)) {
          roots.push(resolve(worktree.path))
        }
      } catch (error) {
        // Why: one inaccessible repo (EACCES/EIO) must not break the whole rebuild and disable File Explorer/Quick Open for the rest; skip it.
        console.warn(`[filesystem-auth] skipping repo ${repo.path} during cache rebuild:`, error)
      }
      return { repoId: repo.id, roots }
    }
  )

  registeredWorktreeRoots.clear()
  registeredWorktreeRootsByRepo.clear()
  registeredWorktreeRootRepoIds.clear()
  for (const { repoId, roots } of perProjectResults) {
    const normalizedRoots = new Set<string>()
    for (const root of roots) {
      normalizedRoots.add(root)
      registeredWorktreeRoots.add(root)
    }
    registeredWorktreeRootsByRepo.set(repoId, normalizedRoots)
    registeredWorktreeRootRepoIds.add(repoId)
  }
  registeredWorktreeRootsDirty = false
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  maxConcurrent: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0
  const workerCount = Math.min(maxConcurrent, items.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(items[index])
      }
    })
  )
  return results
}

export function registerWorktreeRootsForRepo(
  store: Store,
  repoId: string,
  worktreeRoots: string[]
): void {
  const localRepoIds = new Set(getLocalRepos(store).map((repo) => repo.id))
  for (const registeredRepoId of registeredWorktreeRootsByRepo.keys()) {
    if (!localRepoIds.has(registeredRepoId)) {
      registeredWorktreeRootsByRepo.delete(registeredRepoId)
      registeredWorktreeRootRepoIds.delete(registeredRepoId)
    }
  }

  if (!localRepoIds.has(repoId)) {
    refreshRegisteredWorktreeRoots()
    registeredWorktreeRootsDirty = !allLocalRepoRootsRegistered(localRepoIds)
    return
  }

  registeredWorktreeRootsByRepo.set(repoId, new Set(worktreeRoots.map((root) => resolve(root))))
  registeredWorktreeRootRepoIds.add(repoId)
  refreshRegisteredWorktreeRoots()
  registeredWorktreeRootsDirty = !allLocalRepoRootsRegistered(localRepoIds)
}

export async function ensureAuthorizedRootsCache(store: Store): Promise<void> {
  if (!registeredWorktreeRootsDirty) {
    return
  }
  if (!registeredWorktreeRootsRefresh) {
    registeredWorktreeRootsRefresh = rebuildAuthorizedRootsCache(store).finally(() => {
      registeredWorktreeRootsRefresh = null
    })
  }
  await registeredWorktreeRootsRefresh
}

/**
 * Returns true if the error is an ENOENT (file-not-found) error.
 */
export function isENOENT(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

export type ResolveAuthorizedPathOptions = {
  /**
   * Canonicalize the parent but preserve the leaf so delete/rename target the symlink itself, not its destination (which may live outside allowed roots).
   */
  preserveSymlink?: boolean
}

export async function resolveAuthorizedPath(
  targetPath: string,
  store: Store,
  options: ResolveAuthorizedPathOptions = {}
): Promise<string> {
  const resolvedTarget = resolve(targetPath)
  if (!(await isPathAllowedIncludingRegisteredWorktrees(resolvedTarget, store))) {
    throw new Error(PATH_ACCESS_DENIED_MESSAGE)
  }

  if (options.preserveSymlink) {
    // Canonicalize the parent so ancestor symlinks can't redirect outside allowed roots, but keep the leaf so delete/rename act on the link itself.
    let realParent: string
    try {
      realParent = await realpath(dirname(resolvedTarget))
    } catch (error) {
      if (isENOENT(error)) {
        return resolveAuthorizedMissingPath(resolvedTarget, store)
      }
      throw error
    }
    const candidateTarget = resolve(realParent, basename(resolvedTarget))
    if (
      !(await isPathAllowedIncludingRegisteredWorktrees(candidateTarget, store, {
        canonicalSourcePath: resolvedTarget
      }))
    ) {
      throw new Error(PATH_ACCESS_DENIED_MESSAGE)
    }
    return candidateTarget
  }

  try {
    // Why: Windows/WSL realpath can return UNC-shaped paths; re-resolve to compare against this module's allow-list roots.
    const realTarget = resolve(await realpath(resolvedTarget))
    if (
      !(await isPathAllowedIncludingRegisteredWorktrees(realTarget, store, {
        canonicalSourcePath: resolvedTarget
      }))
    ) {
      throw new Error(PATH_ACCESS_DENIED_MESSAGE)
    }
    return realTarget
  } catch (error) {
    if (!isENOENT(error)) {
      throw error
    }
    return resolveAuthorizedMissingPath(resolvedTarget, store)
  }
}

async function resolveAuthorizedMissingPath(resolvedTarget: string, store: Store): Promise<string> {
  let existingAncestor = resolvedTarget
  const missingSegments: string[] = []

  while (true) {
    try {
      const realAncestor = await realpath(existingAncestor)
      const candidateTarget = resolve(realAncestor, ...missingSegments)
      if (
        !(await isPathAllowedIncludingRegisteredWorktrees(candidateTarget, store, {
          canonicalSourcePath: resolvedTarget
        }))
      ) {
        throw new Error(PATH_ACCESS_DENIED_MESSAGE)
      }
      return candidateTarget
    } catch (error) {
      if (!isENOENT(error)) {
        throw error
      }
      const parent = dirname(existingAncestor)
      if (parent === existingAncestor) {
        throw error
      }
      // Why: create/copy make missing parents after auth; canonicalize nearest existing ancestor to catch symlink escapes without rejecting nested paths.
      missingSegments.unshift(basename(existingAncestor))
      existingAncestor = parent
    }
  }
}

async function isPathAllowedIncludingRegisteredWorktrees(
  targetPath: string,
  store: Store,
  options: { canonicalSourcePath?: string } = {}
): Promise<boolean> {
  if (isPathAllowed(targetPath, store)) {
    return true
  }

  if (isRegisteredWorktreePath(targetPath)) {
    return true
  }

  if (await isPathAllowedByCanonicalAllowedRoot(targetPath, options.canonicalSourcePath, store)) {
    return true
  }

  if (await isPathAllowedByCanonicalRegisteredRoot(targetPath, options.canonicalSourcePath)) {
    return true
  }

  await ensureAuthorizedRootsCache(store)

  // Why: linked worktrees are already git-trusted; reuse the cached root index so reads don't spawn `git worktree list` each time.
  return (
    isRegisteredWorktreePath(targetPath) ||
    (await isPathAllowedByCanonicalRegisteredRoot(targetPath, options.canonicalSourcePath))
  )
}

/**
 * Resolve and verify that a worktree path belongs to a registered repo.
 *
 * Why not resolveAuthorizedPath: linked worktrees can live outside repo/workspace roots; git trusts exact `git worktree list` registration, not containment.
 */
export async function resolveRegisteredWorktreePath(
  worktreePath: string,
  store: Store
): Promise<string> {
  // Reject malformed paths (null byte) early to prevent probing via realpath.
  if (!worktreePath || worktreePath.includes('\0')) {
    throw new Error('Access denied: invalid worktree path')
  }

  const resolvedTarget = resolve(worktreePath)
  if (registeredWorktreeRoots.has(resolvedTarget) || isRepoRoot(store.getRepos(), resolvedTarget)) {
    return resolvedTarget
  }

  if (registeredWorktreeRootsDirty) {
    await ensureAuthorizedRootsCache(store)
  }

  if (registeredWorktreeRoots.has(resolvedTarget)) {
    return resolvedTarget
  }

  // Resolve symlinks only after the cheap registered-root check: on macOS realpath() can trigger TCC prompts.
  const normalizedTarget = await normalizeExistingPath(resolvedTarget)
  if (registeredWorktreeRoots.has(normalizedTarget)) {
    return normalizedTarget
  }

  throw new Error('Access denied: unknown repository or worktree path')
}

function refreshRegisteredWorktreeRoots(): void {
  registeredWorktreeRoots.clear()
  for (const roots of registeredWorktreeRootsByRepo.values()) {
    for (const root of roots) {
      registeredWorktreeRoots.add(root)
    }
  }
}

function allLocalRepoRootsRegistered(localRepoIds: Set<string>): boolean {
  for (const repoId of localRepoIds) {
    if (!registeredWorktreeRootRepoIds.has(repoId)) {
      return false
    }
  }
  return true
}

async function isPathAllowedByCanonicalAllowedRoot(
  targetPath: string,
  sourcePath: string | undefined,
  store: Store
): Promise<boolean> {
  if (!sourcePath) {
    return false
  }
  for (const root of getAllowedRoots(store)) {
    const resolvedRoot = resolve(root)
    if (!isDescendantOrEqual(sourcePath, resolvedRoot)) {
      continue
    }
    // Why: macOS resolves /var→/private/var; canonicalize only the matched root, not the whole repo set.
    const canonicalRoot = await normalizeExistingPath(resolvedRoot)
    if (isDescendantOrEqual(targetPath, canonicalRoot)) {
      return true
    }
  }
  return false
}

function isRegisteredWorktreePath(targetPath: string): boolean {
  for (const root of registeredWorktreeRoots) {
    if (isDescendantOrEqual(targetPath, root)) {
      return true
    }
  }
  return false
}

async function isPathAllowedByCanonicalRegisteredRoot(
  targetPath: string,
  sourcePath: string | undefined
): Promise<boolean> {
  if (!sourcePath) {
    return false
  }
  const textualRoot = findRegisteredWorktreeRoot(sourcePath)
  if (!textualRoot) {
    return false
  }
  const canonicalRoot = await normalizeExistingPath(textualRoot)
  if (!isDescendantOrEqual(targetPath, canonicalRoot)) {
    return false
  }
  // Why: #1524 stopped realpath'ing every root (macOS privacy prompts); cache only the actively-accessed root so /var→/private/var aliases resolve.
  registeredWorktreeRoots.add(canonicalRoot)
  return true
}

function findRegisteredWorktreeRoot(targetPath: string): string | null {
  let bestRoot: string | null = null
  for (const root of registeredWorktreeRoots) {
    if (!isDescendantOrEqual(targetPath, root)) {
      continue
    }
    if (!bestRoot || root.length > bestRoot.length) {
      bestRoot = root
    }
  }
  return bestRoot
}

async function normalizeExistingPath(resolvedPath: string): Promise<string> {
  try {
    return resolve(await realpath(resolvedPath))
  } catch (error) {
    if (isENOENT(error)) {
      return resolvedPath
    }
    throw error
  }
}

export function validateGitRelativeFilePath(worktreePath: string, filePath: string): string {
  if (!filePath || filePath.includes('\0') || resolve(filePath) === filePath) {
    throw new Error('Access denied: invalid git file path')
  }

  const resolvedFilePath = resolve(worktreePath, filePath)
  if (!isDescendantOrEqual(resolvedFilePath, worktreePath)) {
    throw new Error('Access denied: git file path escapes the selected worktree')
  }

  const normalizedRelativePath = relative(worktreePath, resolvedFilePath)
  if (!normalizedRelativePath) {
    throw new Error('Access denied: invalid git file path')
  }

  return normalizedRelativePath
}
