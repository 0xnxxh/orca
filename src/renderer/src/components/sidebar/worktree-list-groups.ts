/* eslint-disable max-lines -- Why: sidebar row construction keeps every grouping mode in one pure module so reveal, virtualized rendering, and tests share the same flat row contract. */
import { CircleX, FolderTree, List, Pin } from 'lucide-react'
import type React from 'react'
import type {
  DetectedWorktree,
  Project,
  ProjectHostSetup,
  FolderWorkspace,
  Repo,
  ProjectGroup,
  ProjectOrderBy,
  Worktree,
  WorktreeLineage,
  WorkspaceStatusDefinition
} from '../../../../shared/types'
import { branchName } from '../../lib/git-utils'
import {
  getWorkspaceStatus,
  getWorkspaceStatusFromGroupKey,
  getWorkspaceStatusGroupKey,
  getWorkspaceStatusVisualMeta
} from './workspace-status'
import {
  ConductorDoneIcon,
  ConductorProgressIcon,
  ConductorReviewIcon
} from './workspace-status-icons'
import {
  getEffectiveProjectGroupManualRank,
  getProjectGroupOwnerHostId as getSharedProjectGroupOwnerHostId,
  getProjectGroupOwnerIdentity,
  UNGROUPED_PROJECT_GROUP_KEY
} from '../../../../shared/project-groups'
import {
  folderWorkspaceKey,
  getProjectGroupSelectorKey,
  parseWorkspaceKey,
  parseProjectGroupSelectorKey
} from '../../../../shared/workspace-scope'
import {
  getFolderWorkspaceCatalogOwnerHostId,
  getFolderWorkspaceRowKey
} from '../../../../shared/folder-workspaces'
import { cloneDefaultWorkspaceStatuses } from '../../../../shared/workspace-statuses'
import type { AppState } from '../../store/types'
import { getGitHubPRCacheKey, getLegacyGitHubPRCacheKey } from '../../store/slices/github-cache-key'
import { getRepoDisplayLabelKey, getRepoDisplayLabelsByPath } from '@/lib/repo-display-labels'
import { translate } from '@/i18n/i18n'
import {
  getExecutionHostLabel,
  LOCAL_EXECUTION_HOST_ID,
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  normalizeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { parseWslUncPath } from '../../../../shared/wsl-paths'
import {
  isWindowsAbsolutePathLike,
  normalizeRuntimePathForComparison
} from '../../../../shared/cross-platform-path'
import {
  getCyclicProjectedWorktreeLineageIds,
  getLineageRenderInfo
} from './worktree-lineage-projection'

export { getLineageRenderInfo } from './worktree-lineage-projection'

export { branchName }

export type WorktreeGroupBy = 'none' | 'workspace-status' | 'repo' | 'pr-status'
export type PinnedWorktreeDisplayPolicy = 'single-location' | 'duplicate-in-groups'

export function getSidebarWorktreeSelectionId(
  worktree: Worktree,
  repo: Repo | undefined,
  defaultHostId: ExecutionHostId
): string {
  return JSON.stringify([getWorktreeExecutionHostId(worktree, repo, defaultHostId), worktree.id])
}

export function getSidebarWorkspaceActivationId(
  worktree: Worktree,
  ownerHostId: ExecutionHostId,
  ambiguousFolderWorkspaceIds: ReadonlySet<string>
): string {
  const scope = parseWorkspaceKey(worktree.id)
  return scope?.type === 'folder' && ambiguousFolderWorkspaceIds.has(scope.folderWorkspaceId)
    ? folderWorkspaceKey(scope.folderWorkspaceId, ownerHostId)
    : worktree.id
}

export type ProjectGroupSidebarIdentity = string

export type ProjectGroupMutationSelector = {
  groupId: string
  ownerHostId: ExecutionHostId
}

export function getProjectGroupOwnerHostId(
  group: Pick<ProjectGroup, 'connectionId' | 'executionHostId'>
): ExecutionHostId {
  return getSharedProjectGroupOwnerHostId(group)
}

export function getProjectGroupSidebarIdentity(
  group: Pick<ProjectGroup, 'id' | 'connectionId' | 'executionHostId'>
): ProjectGroupSidebarIdentity {
  return getProjectGroupOwnerIdentity(group)
}

export function getProjectGroupMutationSelector(
  group: Pick<ProjectGroup, 'id' | 'connectionId' | 'executionHostId'>
): ProjectGroupMutationSelector {
  return { groupId: group.id, ownerHostId: getProjectGroupOwnerHostId(group) }
}

export function hasSingleProjectGroupMutationOwner(
  groups: readonly ProjectGroup[],
  routedHostId: ExecutionHostId
): boolean {
  return (
    groups.length > 0 && groups.every((group) => getProjectGroupOwnerHostId(group) === routedHostId)
  )
}

export function getSingleProjectGroupMutationOwner(
  groups: readonly ProjectGroup[]
): ExecutionHostId | null {
  const ownerHostId = groups[0] ? getProjectGroupOwnerHostId(groups[0]) : null
  if (!ownerHostId || !hasSingleProjectGroupMutationOwner(groups, ownerHostId)) {
    return null
  }
  return new Set(groups.map((group) => group.id)).size === groups.length ? ownerHostId : null
}

export function parseProjectGroupSidebarHeaderKey(
  key: string
): { groupId: string; ownerHostId?: ExecutionHostId } | null {
  return parseProjectGroupSelectorKey(key)
}

export type ProjectGroupSidebarIndex = {
  byIdentity: ReadonlyMap<ProjectGroupSidebarIdentity, ProjectGroup>
  byUnambiguousId: ReadonlyMap<string, ProjectGroup>
  ambiguousIds: ReadonlySet<string>
}

export function buildProjectGroupSidebarIndex(
  projectGroups: readonly ProjectGroup[]
): ProjectGroupSidebarIndex {
  const byIdentity = new Map<ProjectGroupSidebarIdentity, ProjectGroup>()
  const byUnambiguousId = new Map<string, ProjectGroup>()
  const ambiguousIds = new Set<string>()
  for (const group of projectGroups) {
    byIdentity.set(getProjectGroupSidebarIdentity(group), group)
    if (ambiguousIds.has(group.id)) {
      continue
    }
    const existing = byUnambiguousId.get(group.id)
    if (
      existing &&
      getProjectGroupSidebarIdentity(existing) !== getProjectGroupSidebarIdentity(group)
    ) {
      byUnambiguousId.delete(group.id)
      ambiguousIds.add(group.id)
    } else {
      byUnambiguousId.set(group.id, group)
    }
  }
  return { byIdentity, byUnambiguousId, ambiguousIds }
}

export function findProjectGroupForSidebarOwner(
  index: ProjectGroupSidebarIndex,
  groupId: string | null | undefined,
  ownerHostId?: ExecutionHostId | null
): ProjectGroup | undefined {
  if (!groupId) {
    return undefined
  }
  return ownerHostId
    ? index.byIdentity.get(JSON.stringify([ownerHostId, groupId]))
    : index.byUnambiguousId.get(groupId)
}

export function findProjectGroupForRepo(
  index: ProjectGroupSidebarIndex,
  repo: Pick<Repo, 'connectionId' | 'executionHostId' | 'projectGroupId'> | undefined,
  defaultHostId: ExecutionHostId
): ProjectGroup | undefined {
  if (!repo?.projectGroupId) {
    return undefined
  }
  const ownerHostId =
    repo.connectionId || repo.executionHostId ? getRepoExecutionHostId(repo) : defaultHostId
  return findProjectGroupForSidebarOwner(index, repo.projectGroupId, ownerHostId)
}

export function findProjectGroupForFolderWorkspace(
  index: ProjectGroupSidebarIndex,
  workspace: Pick<FolderWorkspace, 'connectionId' | 'executionHostId' | 'projectGroupId'>
): ProjectGroup | undefined {
  const explicitHostId = normalizeExecutionHostId(workspace.executionHostId)
  const ownerHostId =
    explicitHostId ??
    (workspace.connectionId
      ? toSshExecutionHostId(workspace.connectionId)
      : workspace.connectionId === null
        ? LOCAL_EXECUTION_HOST_ID
        : undefined)
  const exact = findProjectGroupForSidebarOwner(index, workspace.projectGroupId, ownerHostId)
  if (
    exact ||
    !workspace.connectionId ||
    ownerHostId !== toSshExecutionHostId(workspace.connectionId)
  ) {
    return exact
  }
  const legacyGroup = index.byUnambiguousId.get(workspace.projectGroupId)
  return legacyGroup !== undefined &&
    legacyGroup.connectionId === undefined &&
    getProjectGroupOwnerHostId(legacyGroup) === LOCAL_EXECUTION_HOST_ID
    ? legacyGroup
    : undefined
}

export function getAmbiguousFolderWorkspaceSidebarIds(
  index: ProjectGroupSidebarIndex,
  workspaces: readonly Pick<
    FolderWorkspace,
    'id' | 'connectionId' | 'executionHostId' | 'projectGroupId'
  >[]
): ReadonlySet<string> {
  const ownerById = new Map<string, ExecutionHostId>()
  const ambiguousIds = new Set<string>()
  for (const workspace of workspaces) {
    const group = findProjectGroupForFolderWorkspace(index, workspace)
    if (!group || ambiguousIds.has(workspace.id)) {
      continue
    }
    const ownerHostId = getFolderWorkspaceCatalogOwnerHostId(workspace, [group])
    const existingOwnerHostId = ownerById.get(workspace.id)
    if (existingOwnerHostId && existingOwnerHostId !== ownerHostId) {
      ownerById.delete(workspace.id)
      ambiguousIds.add(workspace.id)
    } else {
      ownerById.set(workspace.id, ownerHostId)
    }
  }
  return ambiguousIds
}

export function findProjectGroupParentForSidebar(
  index: ProjectGroupSidebarIndex,
  group: ProjectGroup
): ProjectGroup | undefined {
  return findProjectGroupForSidebarOwner(
    index,
    group.parentGroupId,
    getProjectGroupOwnerHostId(group)
  )
}

export function getProjectGroupExecutionHostIdForRows(
  group: Pick<ProjectGroup, 'connectionId' | 'executionHostId'>,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  const executionHostId = normalizeExecutionHostId(group.executionHostId)
  if (executionHostId) {
    return executionHostId
  }
  return group.connectionId ? toSshExecutionHostId(group.connectionId) : defaultHostId
}

export function getFolderWorkspaceExecutionHostIdForRows({
  folderWorkspace,
  projectGroup,
  defaultHostId
}: {
  folderWorkspace: Pick<FolderWorkspace, 'connectionId' | 'executionHostId'>
  projectGroup: Pick<ProjectGroup, 'connectionId' | 'executionHostId'> | undefined
  defaultHostId: ExecutionHostId
}): ExecutionHostId {
  const explicitFolderHostId = normalizeExecutionHostId(folderWorkspace.executionHostId)
  if (explicitFolderHostId) {
    return explicitFolderHostId
  }
  if (projectGroup) {
    const explicitProjectGroupHostId = normalizeExecutionHostId(projectGroup.executionHostId)
    if (explicitProjectGroupHostId === LOCAL_EXECUTION_HOST_ID && folderWorkspace.connectionId) {
      return toSshExecutionHostId(folderWorkspace.connectionId)
    }
    if (explicitProjectGroupHostId) {
      return explicitProjectGroupHostId
    }
    const projectGroupHostId = getProjectGroupExecutionHostIdForRows(projectGroup, defaultHostId)
    if (projectGroupHostId !== defaultHostId || !folderWorkspace.connectionId) {
      return projectGroupHostId
    }
  }
  return folderWorkspace.connectionId
    ? toSshExecutionHostId(folderWorkspace.connectionId)
    : defaultHostId
}

export function getPinnedWorktreeDisplayPolicy(
  settings?: { showPinnedWorktreesInGroups?: boolean } | null
): PinnedWorktreeDisplayPolicy {
  return settings?.showPinnedWorktreesInGroups === true ? 'duplicate-in-groups' : 'single-location'
}

export type GroupHeaderRow = {
  type: 'header'
  key: string
  label: string
  count: number
  tone: string
  icon?: React.ComponentType<{ className?: string }>
  repo?: Repo
  projectGroup?: ProjectGroup | { id: null; name: 'Ungrouped'; tabOrder: number }
  projectGroupOwnerHostId?: ExecutionHostId
  collapseKey?: string
  projectGroupDepth?: number
  hostId?: ExecutionHostId
  hostWorktreeCounts?: ReadonlyMap<ExecutionHostId, number>
  hostWorktreeIds?: ReadonlyMap<ExecutionHostId, readonly string[]>
  hostFolderWorkspaceIds?: ReadonlyMap<ExecutionHostId, readonly string[]>
  worktreeIds?: readonly string[]
  folderWorkspaceIds?: readonly string[]
}

export type WorktreeRow = {
  type: 'item'
  rowKey: string
  sectionKey: string
  worktree: Worktree
  repo: Repo | undefined
  depth: number
  groupDepth: number
  lineageTrail: boolean[]
  isLastLineageChild: boolean
  lineageChildCount: number
  lineageGroupKey?: string
  lineageCollapsed?: boolean
  hostContextLabel?: string
}

export type ImportedWorktreesCardCandidate = {
  repo: Repo
  hiddenWorktrees: DetectedWorktree[]
}

export type ImportedWorktreesCardRow = {
  type: 'imported-worktrees-card'
  key: string
  repo: Repo
  hiddenWorktrees: DetectedWorktree[]
  placement: 'repo-group' | 'pinned-fallback'
}

export type NewExternalWorktreesInboxCandidate = {
  repo: Repo
  inboxWorktrees: DetectedWorktree[]
}

export type NewExternalWorktreesInboxRow = {
  type: 'new-external-worktrees-inbox'
  key: string
  repo: Repo
  inboxWorktrees: DetectedWorktree[]
}

export type PendingCreationRow = {
  type: 'pending-creation'
  key: string
  creationId: string
  repo: Repo | undefined
}

export type FolderWorkspaceRow = {
  type: 'folder-workspace'
  key: string
  folderWorkspace: FolderWorkspace
  projectGroup: ProjectGroup
  depth: number
  groupDepth: number
}

export function getFolderWorkspaceRenderRowKey(row: Pick<FolderWorkspaceRow, 'key'>): string {
  return row.key
}

/** Minimal shape buildRows needs for an in-flight create. Deliberately not the
 *  full PendingWorktreeCreation: row identity depends only on which creates
 *  exist and their repo, so callers can subscribe on this stable shape and keep
 *  progress-field churn (phase/loaderVisible) from rebuilding the whole list. */
export type PendingCreationRef = { creationId: string; repoId: string }

export type Row =
  | GroupHeaderRow
  | WorktreeRow
  | ImportedWorktreesCardRow
  | NewExternalWorktreesInboxRow
  | PendingCreationRow
  | FolderWorkspaceRow

function buildPendingCreationRow(
  creation: PendingCreationRef,
  repoMap: Map<string, Repo>
): PendingCreationRow {
  return {
    type: 'pending-creation',
    key: `pending:${creation.creationId}`,
    creationId: creation.creationId,
    repo: repoMap.get(creation.repoId)
  }
}

type OrderedGroupEntry = [string, WorktreeGroupEntry]

export type ProjectGroupingModel = {
  projects: readonly Project[]
  projectHostSetups: readonly ProjectHostSetup[]
}

type WorktreeGroupEntry = {
  label: string
  items: Worktree[]
  repo?: Repo
  repoIds: Set<string>
}

type ProjectGroupHostMetrics = {
  count: number
  hostCounts: Map<ExecutionHostId, number>
  hostWorktreeIds: Map<ExecutionHostId, string[]>
  hostFolderWorkspaceIds: Map<ExecutionHostId, string[]>
  worktreeIds: string[]
  folderWorkspaceIds: string[]
}

type ProjectGroupingIndex = {
  projectById: Map<string, Project>
  setupByRepoId: Map<string, ProjectHostSetup>
  surfaceKeysRequiringSetupGroups: Set<string>
}

const projectGroupingIndexCache = new WeakMap<ProjectGroupingModel, ProjectGroupingIndex | null>()

// Why: provisioned and folder setups are not independent Git checkouts.
function isDistinctUserCheckout(setup: ProjectHostSetup): boolean {
  return setup.setupMethod !== 'provisioned' && setup.kind !== 'folder'
}

// Why: execution target and filesystem namespace independently identify a surface.
function getProjectSetupSurfaceKey(setup: ProjectHostSetup): string {
  return `${setup.projectId}::${setup.hostId}::${getExecutionSurface(setup)}::${getPathSurface(setup)}`
}

function getExecutionSurface(setup: ProjectHostSetup): string {
  const connectionId = setup.connectionId?.trim()
  if (connectionId) {
    return toSshExecutionHostId(connectionId)
  }
  return setup.executionHostId?.trim() || setup.hostId
}

// Why: projection twins differ by row identity, not checkout directory.
function getCheckoutIdentity(setup: ProjectHostSetup): string {
  return normalizeRuntimePathForComparison(setup.path.trim()) || setup.repoId || setup.id
}

function getPathSurface(setup: ProjectHostSetup): string {
  const wslPath = parseWslUncPath(setup.path)
  if (wslPath) {
    return `wsl:${wslPath.distro.toLowerCase()}`
  }
  if (isWindowsAbsolutePathLike(setup.path)) {
    return 'windows-host'
  }
  return 'default'
}

function buildProjectGroupingIndex(model?: ProjectGroupingModel): ProjectGroupingIndex | null {
  if (!model) {
    return null
  }
  const cached = projectGroupingIndexCache.get(model)
  if (cached !== undefined) {
    return cached
  }
  const projects = model.projects ?? []
  const projectHostSetups = model.projectHostSetups ?? []
  if (projects.length === 0 || projectHostSetups.length === 0) {
    projectGroupingIndexCache.set(model, null)
    return null
  }
  const checkoutsByProjectSurface = new Map<string, Set<string>>()
  for (const setup of projectHostSetups) {
    if (!isDistinctUserCheckout(setup)) {
      continue
    }
    const key = getProjectSetupSurfaceKey(setup)
    const existing = checkoutsByProjectSurface.get(key)
    if (existing) {
      existing.add(getCheckoutIdentity(setup))
    } else {
      checkoutsByProjectSurface.set(key, new Set([getCheckoutIdentity(setup)]))
    }
  }
  const surfaceKeysRequiringSetupGroups = new Set<string>()
  for (const [surfaceKey, checkouts] of checkoutsByProjectSurface) {
    if (checkouts.size > 1) {
      surfaceKeysRequiringSetupGroups.add(surfaceKey)
    }
  }
  const index = {
    projectById: new Map(projects.map((project) => [project.id, project])),
    setupByRepoId: new Map(projectHostSetups.map((setup) => [setup.repoId, setup])),
    surfaceKeysRequiringSetupGroups
  }
  projectGroupingIndexCache.set(model, index)
  return index
}

export type ProjectHeaderRevealTarget = {
  key: string
  label: string
  repo?: Repo
  projectId?: string
}

function getProjectGroupingForRepo(
  repoId: string,
  repoMap: Map<string, Repo>,
  projectIndex: ProjectGroupingIndex | null
): ProjectHeaderRevealTarget {
  const repo = repoMap.get(repoId)
  const setup = projectIndex?.setupByRepoId.get(repoId)
  const project = setup ? projectIndex?.projectById.get(setup.projectId) : undefined
  if (!setup || !project) {
    return {
      key: `repo:${repoId}`,
      label: repo?.displayName ?? 'Unknown',
      repo
    }
  }
  if (
    projectIndex?.surfaceKeysRequiringSetupGroups.has(getProjectSetupSurfaceKey(setup)) &&
    isDistinctUserCheckout(setup)
  ) {
    // Why: only the ambiguous surface needs checkout-specific headers.
    return {
      key: `project:${project.id}::setup:${repoId}`,
      label: repo?.displayName ?? setup.displayName,
      repo,
      projectId: project.id
    }
  }
  // Why: provisioned runtime copies and non-ambiguous checkouts follow project
  // identity rather than path-scoped setup identity, so they stay in one project.
  return {
    key: `project:${project.id}`,
    label: project.displayName,
    repo,
    projectId: project.id
  }
}

export function getProjectHeaderRevealTarget(
  repoId: string,
  repoMap: Map<string, Repo>,
  projectGrouping?: ProjectGroupingModel
): ProjectHeaderRevealTarget {
  return getProjectGroupingForRepo(repoId, repoMap, buildProjectGroupingIndex(projectGrouping))
}

function addRepoIdToGroup(group: WorktreeGroupEntry, repoId: string): void {
  group.repoIds.add(repoId)
}

export type PRGroupKey = 'done' | 'in-review' | 'in-progress' | 'closed'

export const PR_GROUP_ORDER: PRGroupKey[] = ['done', 'in-review', 'in-progress', 'closed']

export const PR_GROUP_META: Record<
  PRGroupKey,
  {
    label: string
    icon: React.ComponentType<{ className?: string }>
    tone: string
  }
> = {
  done: {
    get label() {
      return translate('auto.components.sidebar.worktree.list.groups.5076efc3d2', 'Done')
    },
    icon: ConductorDoneIcon,
    tone: 'text-[#c7a594]'
  },
  'in-review': {
    get label() {
      return translate('auto.components.sidebar.worktree.list.groups.6798dc7c94', 'In review')
    },
    icon: ConductorReviewIcon,
    tone: 'text-[#16a34a]'
  },
  'in-progress': {
    get label() {
      return translate('auto.components.sidebar.worktree.list.groups.7c2f009786', 'In progress')
    },
    icon: ConductorProgressIcon,
    tone: 'text-[#d4a300]'
  },
  closed: {
    get label() {
      return translate('auto.components.sidebar.worktree.list.groups.682ed5d551', 'Closed')
    },
    icon: CircleX,
    tone: 'text-zinc-600 dark:text-zinc-300'
  }
}

export const PROJECT_GROUP_META = {
  tone: 'text-foreground',
  icon: FolderTree
} as const

export function getProjectGroupHeaderKey(
  groupId: string | null,
  ownerHostId?: ExecutionHostId
): string {
  if (!groupId) {
    return UNGROUPED_PROJECT_GROUP_KEY
  }
  return getProjectGroupSelectorKey(groupId, ownerHostId)
}

export const PINNED_GROUP_KEY = 'pinned'

export const PINNED_GROUP_META = {
  get label() {
    return translate('auto.components.sidebar.worktree.list.groups.4aeefc5996', 'Pinned')
  },
  tone: 'text-foreground',
  icon: Pin
} as const

export const ALL_GROUP_KEY = 'all'

export const ALL_GROUP_META = {
  get label() {
    return translate('auto.components.sidebar.worktree.list.groups.0ed04075b8', 'All')
  },
  tone: 'text-foreground',
  icon: List
} as const

export const LINEAGE_GROUP_PREFIX = 'lineage:'

export function getLineageGroupKey(worktreeId: string): string {
  return `${LINEAGE_GROUP_PREFIX}${worktreeId}`
}

export function getPRGroupKey(
  worktree: Worktree,
  repoMap: Map<string, Repo>,
  prCache: Record<string, unknown> | null,
  settings?: AppState['settings']
): PRGroupKey {
  const repo = repoMap.get(worktree.repoId)
  const branch = branchName(worktree.branch)
  const repoScopedCacheKey =
    repo && branch
      ? getGitHubPRCacheKey(
          repo.path,
          repo.id,
          branch,
          settings,
          repo.connectionId,
          repo.executionHostId,
          true
        )
      : ''
  const canUseLegacyPRCache = repo !== undefined && !repo.connectionId && !repo.executionHostId
  const legacyRepoScopedCacheKey =
    canUseLegacyPRCache && branch ? getLegacyGitHubPRCacheKey(repo.path, repo.id, branch) : ''
  const legacyPathScopedCacheKey =
    canUseLegacyPRCache && branch ? getLegacyGitHubPRCacheKey(repo.path, undefined, branch) : ''
  // Why: PR refreshes now write repo-id scoped entries; legacy path entries may
  // still exist from persisted cache, but must not override fresher repo data.
  const prEntry = prCache
    ? ((repoScopedCacheKey
        ? (prCache[repoScopedCacheKey] as { data?: { state?: string } } | undefined)
        : undefined) ??
      (legacyRepoScopedCacheKey
        ? (prCache[legacyRepoScopedCacheKey] as { data?: { state?: string } } | undefined)
        : undefined) ??
      (legacyPathScopedCacheKey
        ? (prCache[legacyPathScopedCacheKey] as { data?: { state?: string } } | undefined)
        : undefined))
    : undefined
  const pr = prEntry?.data

  if (!pr) {
    return 'in-progress'
  }
  if (pr.state === 'merged') {
    return 'done'
  }
  if (pr.state === 'closed') {
    return 'closed'
  }
  if (pr.state === 'draft') {
    return 'in-progress'
  }
  return 'in-review'
}

/**
 * Emit a "Pinned" header + its items into `result`.
 *
 * Why: the dedicated Pinned section is always present for pinned worktrees;
 * the display policy decides whether their natural group rows also render.
 */
function emitPinnedGroup(
  worktrees: Worktree[],
  repoMap: Map<string, Repo>,
  defaultHostId: ExecutionHostId,
  collapsedGroups: Set<string>,
  renderedNaturalAnchorRepoIds: ReadonlySet<string>,
  importedWorktreesByRepo: ReadonlyMap<string, ImportedWorktreesCardCandidate>,
  allowImportedFallback: boolean,
  result: Row[]
): void {
  const pinned = worktrees.filter((w) => w.isPinned)
  if (pinned.length === 0) {
    return
  }
  const hostWorktreeCounts = new Map<ExecutionHostId, number>()
  const hostWorktreeIds = new Map<ExecutionHostId, string[]>()
  const pinnedRepoOrder: string[] = []
  const seenPinnedRepoIds = new Set<string>()
  for (const worktree of pinned) {
    const hostId = getWorktreeExecutionHostId(worktree, repoMap.get(worktree.repoId), defaultHostId)
    hostWorktreeCounts.set(hostId, (hostWorktreeCounts.get(hostId) ?? 0) + 1)
    const hostIds = hostWorktreeIds.get(hostId) ?? []
    hostIds.push(worktree.id)
    hostWorktreeIds.set(hostId, hostIds)
    if (!seenPinnedRepoIds.has(worktree.repoId)) {
      pinnedRepoOrder.push(worktree.repoId)
      seenPinnedRepoIds.add(worktree.repoId)
    }
  }

  result.push({
    type: 'header',
    key: PINNED_GROUP_KEY,
    label: PINNED_GROUP_META.label,
    count: pinned.length,
    tone: PINNED_GROUP_META.tone,
    icon: PINNED_GROUP_META.icon,
    hostWorktreeCounts,
    hostWorktreeIds,
    worktreeIds: pinned.map((worktree) => worktree.id)
  })
  if (collapsedGroups.has(PINNED_GROUP_KEY)) {
    for (const repoId of pinnedRepoOrder) {
      const candidate = importedWorktreesByRepo.get(repoId)
      if (allowImportedFallback && candidate && !renderedNaturalAnchorRepoIds.has(repoId)) {
        result.push(buildImportedWorktreesCardRow(candidate, 'pinned-fallback'))
      }
    }
  } else {
    const lastPinnedIndexByRepoId = new Map<string, number>()
    pinned.forEach((worktree, index) => lastPinnedIndexByRepoId.set(worktree.repoId, index))
    for (const [index, worktree] of pinned.entries()) {
      result.push(
        buildWorktreeRow(worktree, repoMap, {
          rowKey: `${PINNED_GROUP_KEY}:${worktree.id}`,
          sectionKey: PINNED_GROUP_KEY,
          depth: 0,
          groupDepth: 0,
          lineageTrail: [],
          isLastLineageChild: false,
          lineageChildCount: 0,
          lineageCollapsed: false
        })
      )
      const candidate = importedWorktreesByRepo.get(worktree.repoId)
      if (
        allowImportedFallback &&
        candidate &&
        !renderedNaturalAnchorRepoIds.has(worktree.repoId) &&
        lastPinnedIndexByRepoId.get(worktree.repoId) === index
      ) {
        result.push(buildImportedWorktreesCardRow(candidate, 'pinned-fallback'))
      }
    }
  }
}

function buildImportedWorktreesCardRow(
  candidate: ImportedWorktreesCardCandidate,
  placement: ImportedWorktreesCardRow['placement']
): ImportedWorktreesCardRow {
  return {
    type: 'imported-worktrees-card',
    key: `imported-worktrees-card:${placement}:${candidate.repo.id}`,
    repo: candidate.repo,
    hiddenWorktrees: candidate.hiddenWorktrees,
    placement
  }
}

function buildNewExternalWorktreesInboxRow(
  candidate: NewExternalWorktreesInboxCandidate
): NewExternalWorktreesInboxRow {
  return {
    type: 'new-external-worktrees-inbox',
    key: `new-external-worktrees-inbox:${candidate.repo.id}`,
    repo: candidate.repo,
    inboxWorktrees: candidate.inboxWorktrees
  }
}

function buildWorktreeRow(
  worktree: Worktree,
  repoMap: Map<string, Repo>,
  options: {
    rowKey: string
    sectionKey: string
    depth: number
    groupDepth: number
    lineageTrail: boolean[]
    isLastLineageChild: boolean
    lineageChildCount: number
    lineageCollapsed: boolean
    hostContextLabel?: string
  }
): WorktreeRow {
  return {
    type: 'item',
    rowKey: options.rowKey,
    sectionKey: options.sectionKey,
    worktree,
    repo: repoMap.get(worktree.repoId),
    depth: options.depth,
    groupDepth: options.groupDepth,
    lineageTrail: options.lineageTrail,
    isLastLineageChild: options.isLastLineageChild,
    lineageChildCount: options.lineageChildCount,
    ...(options.hostContextLabel ? { hostContextLabel: options.hostContextLabel } : {}),
    ...(options.lineageChildCount > 0 ? { lineageGroupKey: getLineageGroupKey(worktree.id) } : {}),
    ...(options.lineageChildCount > 0 ? { lineageCollapsed: options.lineageCollapsed } : {})
  }
}

function appendWorktreeRows(
  result: Row[],
  worktrees: Worktree[],
  repoMap: Map<string, Repo>,
  lineageById: Record<string, WorktreeLineage>,
  worktreeMap: Map<string, Worktree>,
  options: {
    nestLineage: boolean
    collapsedGroups: Set<string>
    groupDepth: number
    sectionKey: string
    hostContextLabelByRepoId?: ReadonlyMap<string, string>
    hostContextLabelByWorktreeId?: ReadonlyMap<string, string>
    cyclicLineageIds: ReadonlySet<string>
  }
): void {
  const {
    nestLineage,
    collapsedGroups,
    groupDepth,
    sectionKey,
    hostContextLabelByRepoId,
    hostContextLabelByWorktreeId,
    cyclicLineageIds
  } = options
  if (!nestLineage) {
    for (const worktree of worktrees) {
      result.push(
        buildWorktreeRow(worktree, repoMap, {
          rowKey: `${sectionKey}:${worktree.id}`,
          sectionKey,
          depth: 0,
          groupDepth,
          lineageTrail: [],
          isLastLineageChild: false,
          lineageChildCount: 0,
          lineageCollapsed: false,
          hostContextLabel:
            hostContextLabelByWorktreeId?.get(worktree.id) ??
            hostContextLabelByRepoId?.get(worktree.repoId)
        })
      )
    }
    return
  }

  const visibleIds = new Set(worktrees.map((worktree) => worktree.id))
  const childrenByParentId = new Map<string, Worktree[]>()
  const childIds = new Set<string>()
  for (const worktree of worktrees) {
    const lineage = getLineageRenderInfo(worktree, lineageById, worktreeMap, cyclicLineageIds)
    if (lineage.state !== 'valid' || !visibleIds.has(lineage.parent.id)) {
      continue
    }
    childIds.add(worktree.id)
    const children = childrenByParentId.get(lineage.parent.id) ?? []
    children.push(worktree)
    childrenByParentId.set(lineage.parent.id, children)
  }

  const emitted = new Set<string>()
  const emit = (
    worktree: Worktree,
    depth: number,
    lineageTrail: boolean[],
    isLastChild: boolean
  ): void => {
    if (emitted.has(worktree.id)) {
      return
    }
    const children = childrenByParentId.get(worktree.id) ?? []
    const lineageGroupKey = getLineageGroupKey(worktree.id)
    const lineageCollapsed = collapsedGroups.has(lineageGroupKey)
    emitted.add(worktree.id)
    result.push(
      buildWorktreeRow(worktree, repoMap, {
        rowKey: `${sectionKey}:${worktree.id}`,
        sectionKey,
        depth,
        groupDepth,
        lineageTrail,
        isLastLineageChild: isLastChild,
        lineageChildCount: children.length,
        lineageCollapsed,
        hostContextLabel:
          hostContextLabelByWorktreeId?.get(worktree.id) ??
          hostContextLabelByRepoId?.get(worktree.repoId)
      })
    )
    if (lineageCollapsed) {
      return
    }
    children.forEach((child, index) => {
      emit(
        child,
        depth + 1,
        [...lineageTrail, index < children.length - 1],
        index === children.length - 1
      )
    })
  }

  const roots = worktrees.filter((worktree) => !childIds.has(worktree.id))
  for (const [index, worktree] of roots.entries()) {
    emit(worktree, 0, [], index === roots.length - 1)
  }
  if (roots.length === 0) {
    for (const worktree of worktrees) {
      if (!emitted.has(worktree.id)) {
        // Why: malformed cyclic lineage should not hide every participant.
        // Render any leftovers as roots rather than recursing forever.
        emit(worktree, 0, [], true)
      }
    }
  }
}

function getRepoHostLabel(
  repoId: string,
  repoMap: Map<string, Repo>,
  projectIndex: ProjectGroupingIndex | null,
  hostLabelById: ReadonlyMap<string, string> | undefined
): string | null {
  const setup = projectIndex?.setupByRepoId.get(repoId)
  if (setup) {
    return hostLabelById?.get(setup.hostId) ?? getExecutionHostLabel(setup.hostId)
  }
  const repo = repoMap.get(repoId)
  if (!repo) {
    return null
  }
  const hostId = getRepoExecutionHostId(repo)
  return hostLabelById?.get(hostId) ?? getExecutionHostLabel(hostId)
}

function getMixedHostContextLabels(
  group: WorktreeGroupEntry,
  repoMap: Map<string, Repo>,
  projectIndex: ProjectGroupingIndex | null,
  hostLabelById: ReadonlyMap<string, string> | undefined
): Map<string, string> | undefined {
  const labelsByRepoId = new Map<string, string>()
  const uniqueLabels = new Set<string>()
  for (const repoId of group.repoIds) {
    const label = getRepoHostLabel(repoId, repoMap, projectIndex, hostLabelById)
    if (!label) {
      continue
    }
    labelsByRepoId.set(repoId, label)
    uniqueLabels.add(label)
  }
  return uniqueLabels.size > 1 ? labelsByRepoId : undefined
}

function getMixedWorktreeHostContextLabels(
  worktrees: readonly Worktree[],
  repoMap: Map<string, Repo>,
  hostLabelById: ReadonlyMap<string, string> | undefined,
  defaultHostId: ExecutionHostId
): Map<string, string> | undefined {
  const labelsByWorktreeId = new Map<string, string>()
  const uniqueHostIds = new Set<ExecutionHostId>()
  for (const worktree of worktrees) {
    const hostId = getWorktreeExecutionHostId(worktree, repoMap.get(worktree.repoId), defaultHostId)
    uniqueHostIds.add(hostId)
    labelsByWorktreeId.set(worktree.id, hostLabelById?.get(hostId) ?? getExecutionHostLabel(hostId))
  }
  return uniqueHostIds.size > 1 ? labelsByWorktreeId : undefined
}

function getHostWorktreeCounts(
  worktrees: readonly Worktree[],
  repoMap: Map<string, Repo>,
  defaultHostId: ExecutionHostId
): Map<ExecutionHostId, number> | undefined {
  if (worktrees.length === 0) {
    return undefined
  }
  const counts = new Map<ExecutionHostId, number>()
  const seenWorktreeIds = new Set<string>()
  for (const worktree of worktrees) {
    if (seenWorktreeIds.has(worktree.id)) {
      continue
    }
    seenWorktreeIds.add(worktree.id)
    const hostId = getWorktreeExecutionHostId(worktree, repoMap.get(worktree.repoId), defaultHostId)
    counts.set(hostId, (counts.get(hostId) ?? 0) + 1)
  }
  return counts
}

function getHostWorktreeIds(
  worktrees: readonly Worktree[],
  repoMap: Map<string, Repo>,
  defaultHostId: ExecutionHostId
): Map<ExecutionHostId, string[]> | undefined {
  if (worktrees.length === 0) {
    return undefined
  }
  const idsByHost = new Map<ExecutionHostId, string[]>()
  const seenWorktreeIds = new Set<string>()
  for (const worktree of worktrees) {
    if (seenWorktreeIds.has(worktree.id)) {
      continue
    }
    seenWorktreeIds.add(worktree.id)
    const hostId = getWorktreeExecutionHostId(worktree, repoMap.get(worktree.repoId), defaultHostId)
    const ids = idsByHost.get(hostId) ?? []
    ids.push(worktree.id)
    idsByHost.set(hostId, ids)
  }
  return idsByHost
}

function getRenderedNaturalAnchorRepoIds({
  groupBy,
  worktrees,
  repoMap,
  prCache,
  collapsedGroups,
  workspaceStatuses,
  settings,
  projectGrouping
}: {
  groupBy: WorktreeGroupBy
  worktrees: readonly Worktree[]
  repoMap: Map<string, Repo>
  prCache: Record<string, unknown> | null
  collapsedGroups: ReadonlySet<string>
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  settings?: AppState['settings']
  projectGrouping?: ProjectGroupingModel
}): Set<string> {
  const renderedRepoIds = new Set<string>()
  if (groupBy === 'none') {
    if (!collapsedGroups.has(ALL_GROUP_KEY)) {
      for (const worktree of worktrees) {
        renderedRepoIds.add(worktree.repoId)
      }
    }
    return renderedRepoIds
  }
  if (groupBy === 'repo') {
    for (const worktree of worktrees) {
      renderedRepoIds.add(worktree.repoId)
    }
    return renderedRepoIds
  }
  for (const worktree of worktrees) {
    const groupKey = getGroupKeyForWorktree(
      groupBy,
      worktree,
      repoMap,
      prCache,
      workspaceStatuses,
      settings,
      projectGrouping
    )
    if (groupKey && !collapsedGroups.has(groupKey)) {
      renderedRepoIds.add(worktree.repoId)
    }
  }
  return renderedRepoIds
}

function orderMainWorktreeFirst(worktrees: Worktree[]): Worktree[] {
  const mainWorktrees = worktrees.filter((worktree) => worktree.isMainWorktree)
  if (mainWorktrees.length === 0) {
    return worktrees
  }
  // Why: project groups are scanned by repo; keep the repo's canonical
  // workspace anchored even when dynamic sorts rank a child workspace first.
  return [...mainWorktrees, ...worktrees.filter((worktree) => !worktree.isMainWorktree)]
}

function withRepoSectionDisplayLabels(entries: readonly OrderedGroupEntry[]): OrderedGroupEntry[] {
  const repos = entries
    .map((entry) => entry[1].repo)
    .filter((repo): repo is Repo => repo !== undefined)
  if (repos.length < 2) {
    return [...entries]
  }
  const labelsByPath = getRepoDisplayLabelsByPath(repos)
  return entries.map(([key, group]) => [
    key,
    group.repo
      ? { ...group, label: labelsByPath.get(getRepoDisplayLabelKey(group.repo)) ?? group.label }
      : group
  ])
}

/**
 * Recent rank for a project header. `hasActivity` projects (at least one
 * visible worktree) always sort before fallback projects, regardless of the
 * numeric values — a placeholder's `addedAt` must never outrank real activity.
 * Within each tier, higher timestamps come first.
 */
type RecentRank = { hasActivity: boolean; ts: number }

function recentRankForEntry(entry: OrderedGroupEntry): RecentRank {
  let max = Number.NEGATIVE_INFINITY
  for (const worktree of entry[1].items) {
    if (worktree.lastActivityAt > max) {
      max = worktree.lastActivityAt
    }
  }
  if (max !== Number.NEGATIVE_INFINITY) {
    // Why: Recent must be timestamp-based, not encounter order — the incoming
    // array is no longer pre-sorted by recency once decoupled from sortBy.
    return { hasActivity: true, ts: max }
  }
  const addedAt = entry[1].repo?.addedAt
  return {
    hasActivity: false,
    ts: typeof addedAt === 'number' ? addedAt : Number.NEGATIVE_INFINITY
  }
}

function compareRecentRank(a: RecentRank, b: RecentRank): number {
  if (a.hasActivity !== b.hasActivity) {
    return a.hasActivity ? -1 : 1
  }
  return b.ts - a.ts
}

function manualRankForEntry(
  entry: OrderedGroupEntry,
  repoOrder: Map<string, number> | undefined
): number {
  const key = entry[0]
  const repoIds =
    entry[1].repoIds.size > 0
      ? [...entry[1].repoIds]
      : [key.startsWith('repo:') ? key.slice('repo:'.length) : key]
  let rank = Number.POSITIVE_INFINITY
  for (const repoId of repoIds) {
    const repoRank = repoOrder?.get(repoId)
    if (repoRank !== undefined && repoRank < rank) {
      rank = repoRank
    }
  }
  return rank
}

function getManualOrderAnchorRepo(
  group: WorktreeGroupEntry,
  repoMap: Map<string, Repo>,
  repoOrder: Map<string, number> | undefined
): Repo | undefined {
  let anchor = group.repo
  let anchorRank = anchor ? (repoOrder?.get(anchor.id) ?? Number.POSITIVE_INFINITY) : undefined
  for (const repoId of group.repoIds) {
    const repo = repoMap.get(repoId)
    if (!repo) {
      continue
    }
    const rank = repoOrder?.get(repoId) ?? Number.POSITIVE_INFINITY
    if (!anchor || rank < (anchorRank ?? Number.POSITIVE_INFINITY)) {
      anchor = repo
      anchorRank = rank
    }
  }
  return anchor
}

/**
 * Order project header entries by the user's project-order preference. Manual
 * follows the canonical repoOrder; Recent follows each project's most recent
 * visible workspace activity (descending), with empty/imported-only projects
 * sorting after active ones, then by manual rank, then label.
 */
function sortProjectEntries(
  entries: OrderedGroupEntry[],
  projectOrderBy: ProjectOrderBy,
  repoOrder: Map<string, number> | undefined
): OrderedGroupEntry[] {
  if (projectOrderBy === 'recent') {
    return [...entries].sort((a, b) => {
      const byRecent = compareRecentRank(recentRankForEntry(a), recentRankForEntry(b))
      if (byRecent !== 0) {
        return byRecent
      }
      const ma = manualRankForEntry(a, repoOrder)
      const mb = manualRankForEntry(b, repoOrder)
      if (ma !== mb) {
        return ma - mb
      }
      return a[1].label.localeCompare(b[1].label)
    })
  }
  if (!repoOrder) {
    return entries
  }
  return [...entries].sort((a, b) => {
    const ra = manualRankForEntry(a, repoOrder)
    const rb = manualRankForEntry(b, repoOrder)
    if (ra !== rb) {
      return ra - rb
    }
    return a[1].label.localeCompare(b[1].label)
  })
}

/**
 * Build the flat row list consumed by the virtualizer.
 * Extracted here to keep WorktreeList.tsx under the line-count lint limit.
 */
export function buildRows(
  groupBy: WorktreeGroupBy,
  worktrees: Worktree[],
  repoMap: Map<string, Repo>,
  prCache: Record<string, unknown> | null,
  collapsedGroups: Set<string>,
  repoOrder?: Map<string, number>,
  workspaceStatuses: readonly WorkspaceStatusDefinition[] = cloneDefaultWorkspaceStatuses(),
  projectOrderBy: ProjectOrderBy = 'manual',
  lineageById: Record<string, WorktreeLineage> = {},
  worktreeMap: Map<string, Worktree> = new Map(
    worktrees.map((worktree) => [worktree.id, worktree])
  ),
  nestLineage = false,
  settings?: AppState['settings'],
  projectGroups: readonly ProjectGroup[] = [],
  placeholderRepoIds: ReadonlySet<string> = new Set(),
  importedWorktreesByRepo: ReadonlyMap<string, ImportedWorktreesCardCandidate> = new Map(),
  newExternalWorktreesInboxByRepo: ReadonlyMap<
    string,
    NewExternalWorktreesInboxCandidate
  > = new Map(),
  pendingCreations: readonly PendingCreationRef[] = [],
  projectGrouping?: ProjectGroupingModel,
  folderWorkspaces: readonly FolderWorkspace[] = [],
  hostLabelById?: ReadonlyMap<string, string>,
  defaultHostId: ExecutionHostId = LOCAL_EXECUTION_HOST_ID,
  pinnedDisplayPolicy: PinnedWorktreeDisplayPolicy = getPinnedWorktreeDisplayPolicy(settings),
  ownerQualifiedProjectGroupIds: ReadonlySet<string> = new Set(),
  ownerQualifiedFolderWorkspaceIds: ReadonlySet<string> = new Set()
): Row[] {
  const result: Row[] = []
  const projectIndex = buildProjectGroupingIndex(projectGrouping)
  const cyclicLineageIds = nestLineage
    ? getCyclicProjectedWorktreeLineageIds(lineageById, worktreeMap)
    : new Set<string>()

  const pendingByRepo = new Map<string, PendingCreationRef[]>()
  for (const creation of pendingCreations) {
    const list = pendingByRepo.get(creation.repoId) ?? []
    list.push(creation)
    pendingByRepo.set(creation.repoId, list)
  }

  // Why: non-repo groupings have no repo section to nest an in-progress create
  // under, so surface them at the very top (where the old global strip sat)
  // rather than dropping them. Repo grouping nests them under their repo below.
  if (groupBy !== 'repo' && pendingCreations.length > 0) {
    for (const creation of pendingCreations) {
      result.push(buildPendingCreationRow(creation, repoMap))
    }
  }

  const naturalWorktrees =
    pinnedDisplayPolicy === 'duplicate-in-groups'
      ? worktrees
      : worktrees.filter((worktree) => !worktree.isPinned)
  const mixedWorktreeHostContextLabels = getMixedWorktreeHostContextLabels(
    naturalWorktrees,
    repoMap,
    hostLabelById,
    defaultHostId
  )
  const renderedNaturalAnchorRepoIds = getRenderedNaturalAnchorRepoIds({
    groupBy,
    worktrees: naturalWorktrees,
    repoMap,
    prCache,
    collapsedGroups,
    workspaceStatuses,
    settings,
    projectGrouping
  })
  emitPinnedGroup(
    worktrees,
    repoMap,
    defaultHostId,
    collapsedGroups,
    renderedNaturalAnchorRepoIds,
    importedWorktreesByRepo,
    groupBy !== 'repo',
    result
  )
  if (groupBy === 'none') {
    if (naturalWorktrees.length > 0) {
      result.push({
        type: 'header',
        key: ALL_GROUP_KEY,
        label: ALL_GROUP_META.label,
        count: naturalWorktrees.length,
        tone: ALL_GROUP_META.tone,
        icon: ALL_GROUP_META.icon,
        hostWorktreeCounts: getHostWorktreeCounts(naturalWorktrees, repoMap, defaultHostId),
        hostWorktreeIds: getHostWorktreeIds(naturalWorktrees, repoMap, defaultHostId),
        worktreeIds: naturalWorktrees.map((worktree) => worktree.id)
      })
      if (!collapsedGroups.has(ALL_GROUP_KEY)) {
        appendWorktreeRows(result, naturalWorktrees, repoMap, lineageById, worktreeMap, {
          nestLineage,
          collapsedGroups,
          groupDepth: 0,
          sectionKey: ALL_GROUP_KEY,
          hostContextLabelByWorktreeId: mixedWorktreeHostContextLabels,
          cyclicLineageIds
        })
      }
    }
    return result
  }

  const grouped = new Map<string, WorktreeGroupEntry>()
  for (const w of naturalWorktrees) {
    let key: string
    let label: string
    let repo: Repo | undefined
    if (groupBy === 'repo') {
      const grouping = getProjectGroupingForRepo(w.repoId, repoMap, projectIndex)
      key = grouping.key
      label = grouping.label
      repo = grouping.repo
    } else if (groupBy === 'workspace-status') {
      const workspaceStatus = getWorkspaceStatus(w, workspaceStatuses)
      key = getWorkspaceStatusGroupKey(workspaceStatus)
      label =
        workspaceStatuses.find((status) => status.id === workspaceStatus)?.label ?? workspaceStatus
    } else {
      const prGroup = getPRGroupKey(w, repoMap, prCache, settings)
      key = `pr:${prGroup}`
      label = PR_GROUP_META[prGroup].label
    }
    if (!grouped.has(key)) {
      grouped.set(key, { label, items: [], repo, repoIds: new Set() })
    }
    const group = grouped.get(key)!
    group.items.push(w)
    addRepoIdToGroup(group, w.repoId)
  }
  if (groupBy === 'repo') {
    for (const repoId of placeholderRepoIds) {
      const grouping = getProjectGroupingForRepo(repoId, repoMap, projectIndex)
      if (!grouping.repo) {
        continue
      }
      const key = grouping.key
      if (!grouped.has(key)) {
        // Why: repos can arrive before worktree scans, but stale IDs passed by
        // older snapshots must not render an "Unknown" project header.
        grouped.set(key, {
          label: grouping.label,
          items: [],
          repo: grouping.repo,
          repoIds: new Set([repoId])
        })
      } else {
        addRepoIdToGroup(grouped.get(key)!, repoId)
      }
    }
  }
  if (groupBy === 'repo') {
    for (const [repoId, candidate] of importedWorktreesByRepo) {
      const grouping = getProjectGroupingForRepo(repoId, repoMap, projectIndex)
      const key = grouping.key
      if (!grouped.has(key)) {
        grouped.set(key, {
          label: grouping.label,
          items: [],
          repo: grouping.repo ?? candidate.repo,
          repoIds: new Set([repoId])
        })
      } else if (grouped.has(key)) {
        addRepoIdToGroup(grouped.get(key)!, repoId)
      }
    }
  }
  if (groupBy === 'repo') {
    for (const [repoId, candidate] of newExternalWorktreesInboxByRepo) {
      const grouping = getProjectGroupingForRepo(repoId, repoMap, projectIndex)
      const key = grouping.key
      if (!grouped.has(key)) {
        // Why: the default policy removes pinned worktrees from natural groups,
        // but actionable inbox rows still need a project section to render in.
        grouped.set(key, {
          label: grouping.label,
          items: [],
          repo: grouping.repo ?? candidate.repo,
          repoIds: new Set([repoId])
        })
      } else if (grouped.has(key)) {
        addRepoIdToGroup(grouped.get(key)!, repoId)
      }
    }
  }
  if (groupBy === 'repo') {
    for (const repoId of pendingByRepo.keys()) {
      const grouping = getProjectGroupingForRepo(repoId, repoMap, projectIndex)
      const key = grouping.key
      if (!grouped.has(key)) {
        // Why: creating the first worktree in a repo leaves it with no group yet;
        // ensure one so the in-progress row nests under its repo instead of being
        // dropped.
        grouped.set(key, {
          label: grouping.label,
          items: [],
          repo: grouping.repo,
          repoIds: new Set([repoId])
        })
      } else {
        addRepoIdToGroup(grouped.get(key)!, repoId)
      }
    }
  }

  const orderedGroups: OrderedGroupEntry[] = []
  if (groupBy === 'pr-status') {
    for (const prGroup of PR_GROUP_ORDER) {
      const key = `pr:${prGroup}`
      const group = grouped.get(key)
      if (group) {
        orderedGroups.push([key, group])
      }
    }
  } else if (groupBy === 'workspace-status') {
    // Why: status grouping is opt-in while the board drawer remains the wider
    // all-lanes drag target; keep the sidebar compact by omitting empty lanes.
    for (const status of workspaceStatuses) {
      const key = getWorkspaceStatusGroupKey(status.id)
      const group = grouped.get(key)
      if (group) {
        orderedGroups.push([key, group])
      }
    }
  } else {
    for (const group of grouped.values()) {
      // Why: logical project headers can contain multiple host setup repos.
      // Use the repo that anchors manual order so drag and actions target the
      // same persisted order source the row sorter reads.
      group.repo = getManualOrderAnchorRepo(group, repoMap, repoOrder)
    }
    // Why: project header order is its own user choice (projectOrderBy),
    // decoupled from workspace sortBy. Manual uses the canonical repoOrder so
    // header drag has a stable source of truth; Recent follows activity.
    const entries = sortProjectEntries(Array.from(grouped.entries()), projectOrderBy, repoOrder)
    // Why: large imported repo sets can have one group per repo; spreading
    // those entries into push can exceed V8's argument limit.
    for (const entry of entries) {
      orderedGroups.push(entry)
    }
  }

  const appendOrderedGroups = (
    groupsToAppend: OrderedGroupEntry[],
    projectGroupDepth = 0
  ): void => {
    for (const [key, group] of groupsToAppend) {
      const isCollapsed = collapsedGroups.has(key)
      const repo = group.repo
      const header =
        groupBy === 'repo'
          ? {
              type: 'header' as const,
              key,
              label: group.label,
              count: group.items.length,
              tone: PROJECT_GROUP_META.tone,
              icon: PROJECT_GROUP_META.icon,
              repo,
              projectGroupDepth,
              hostWorktreeCounts: getHostWorktreeCounts(group.items, repoMap, defaultHostId),
              hostWorktreeIds: getHostWorktreeIds(group.items, repoMap, defaultHostId),
              worktreeIds: group.items.map((worktree) => worktree.id)
            }
          : groupBy === 'workspace-status'
            ? (() => {
                const workspaceStatus =
                  getWorkspaceStatusFromGroupKey(key, workspaceStatuses) ??
                  workspaceStatuses[0]?.id ??
                  'in-progress'
                const definition = workspaceStatuses.find((status) => status.id === workspaceStatus)
                const meta = getWorkspaceStatusVisualMeta(definition ?? workspaceStatus)
                return {
                  type: 'header' as const,
                  key,
                  label: definition?.label ?? workspaceStatus,
                  count: group.items.length,
                  tone: meta.tone,
                  icon: meta.icon,
                  hostWorktreeCounts: getHostWorktreeCounts(group.items, repoMap, defaultHostId),
                  hostWorktreeIds: getHostWorktreeIds(group.items, repoMap, defaultHostId),
                  worktreeIds: group.items.map((worktree) => worktree.id)
                }
              })()
            : (() => {
                const prGroup = key.replace(/^pr:/, '') as PRGroupKey
                const meta = PR_GROUP_META[prGroup]
                return {
                  type: 'header' as const,
                  key,
                  label: meta.label,
                  count: group.items.length,
                  tone: meta.tone,
                  icon: meta.icon,
                  hostWorktreeCounts: getHostWorktreeCounts(group.items, repoMap, defaultHostId),
                  hostWorktreeIds: getHostWorktreeIds(group.items, repoMap, defaultHostId),
                  worktreeIds: group.items.map((worktree) => worktree.id)
                }
              })()

      result.push(header)
      if (!isCollapsed) {
        if (groupBy === 'repo') {
          const repoIds =
            group.repoIds.size > 0
              ? [...group.repoIds]
              : repo
                ? [repo.id]
                : key.startsWith('repo:')
                  ? [key.slice('repo:'.length)]
                  : []
          for (const repoId of repoIds) {
            const candidate = importedWorktreesByRepo.get(repoId)
            if (candidate) {
              result.push(buildImportedWorktreesCardRow(candidate, 'repo-group'))
            }
          }
          for (const repoId of repoIds) {
            const candidate = newExternalWorktreesInboxByRepo.get(repoId)
            if (candidate) {
              result.push(buildNewExternalWorktreesInboxRow(candidate))
            }
          }
          // Why: surface in-progress creates at the top of their own repo so the
          // new workspace appears where it will land, not flashed to the very top
          // of the sidebar.
          for (const repoId of repoIds) {
            for (const creation of pendingByRepo.get(repoId) ?? []) {
              result.push(buildPendingCreationRow(creation, repoMap))
            }
          }
        }
        const items = groupBy === 'repo' ? orderMainWorktreeFirst(group.items) : group.items
        const hostContextLabelByRepoId =
          groupBy === 'repo'
            ? getMixedHostContextLabels(group, repoMap, projectIndex, hostLabelById)
            : undefined
        const hostContextLabelByWorktreeId =
          groupBy === 'repo' ? undefined : mixedWorktreeHostContextLabels
        if (groupBy === 'repo') {
          appendWorktreeRows(result, items, repoMap, lineageById, worktreeMap, {
            nestLineage,
            collapsedGroups,
            groupDepth: projectGroupDepth,
            sectionKey: key,
            hostContextLabelByRepoId,
            hostContextLabelByWorktreeId,
            cyclicLineageIds
          })
        } else {
          appendWorktreeRows(result, items, repoMap, lineageById, worktreeMap, {
            nestLineage,
            collapsedGroups,
            groupDepth: projectGroupDepth,
            sectionKey: key,
            hostContextLabelByRepoId,
            hostContextLabelByWorktreeId,
            cyclicLineageIds
          })
        }
      }
    }
  }

  if (groupBy !== 'repo' || projectGroups.length === 0) {
    appendOrderedGroups(
      groupBy === 'repo' ? withRepoSectionDisplayLabels(orderedGroups) : orderedGroups
    )
    return result
  }

  const projectGroupIndex = buildProjectGroupSidebarIndex(projectGroups)
  const ambiguousFolderWorkspaceIds = getAmbiguousFolderWorkspaceSidebarIds(
    projectGroupIndex,
    folderWorkspaces
  )
  const groupByProjectGroupIdentity = new Map<string | null, OrderedGroupEntry[]>()
  for (const entry of orderedGroups) {
    const repo = entry[1].repo
    const projectGroup = findProjectGroupForRepo(projectGroupIndex, repo, defaultHostId)
    const projectGroupIdentity = projectGroup ? getProjectGroupSidebarIdentity(projectGroup) : null
    const list = groupByProjectGroupIdentity.get(projectGroupIdentity) ?? []
    list.push(entry)
    groupByProjectGroupIdentity.set(projectGroupIdentity, list)
  }

  const sortRepoEntriesWithinGroup = (entries: OrderedGroupEntry[]): OrderedGroupEntry[] => {
    if (projectOrderBy === 'recent') {
      return [...entries].sort((left, right) =>
        compareRecentRank(recentRankForEntry(left), recentRankForEntry(right))
      )
    }
    // Manual: within a Project Group, projects order by their per-group rank
    // (projectGroupOrder), falling back to global repoOrder when unset so drag
    // midpoint commits and the rendered order stay aligned.
    return [...entries].sort((left, right) => {
      const leftRank = getEffectiveProjectGroupManualRank(left[1].repo, repoOrder)
      const rightRank = getEffectiveProjectGroupManualRank(right[1].repo, repoOrder)
      return leftRank - rightRank
    })
  }

  const folderWorkspacesByProjectGroupIdentity = new Map<string, FolderWorkspace[]>()
  for (const workspace of folderWorkspaces) {
    const group = findProjectGroupForFolderWorkspace(projectGroupIndex, workspace)
    if (!group?.parentPath) {
      continue
    }
    const identity = getProjectGroupSidebarIdentity(group)
    const list = folderWorkspacesByProjectGroupIdentity.get(identity) ?? []
    list.push(workspace)
    folderWorkspacesByProjectGroupIdentity.set(identity, list)
  }
  for (const list of folderWorkspacesByProjectGroupIdentity.values()) {
    list.sort((left, right) => {
      const leftOrder = left.manualOrder ?? left.sortOrder
      const rightOrder = right.manualOrder ?? right.sortOrder
      return rightOrder - leftOrder || left.name.localeCompare(right.name)
    })
  }
  const childGroupsByParentIdentity = new Map<string | null, ProjectGroup[]>()
  for (const group of projectGroups) {
    const parent = findProjectGroupParentForSidebar(projectGroupIndex, group)
    const parentIdentity = parent ? getProjectGroupSidebarIdentity(parent) : null
    const children = childGroupsByParentIdentity.get(parentIdentity) ?? []
    children.push(group)
    childGroupsByParentIdentity.set(parentIdentity, children)
  }
  for (const groups of childGroupsByParentIdentity.values()) {
    groups.sort(
      (left, right) => left.tabOrder - right.tabOrder || left.name.localeCompare(right.name)
    )
  }

  const projectGroupHostMetricsByIdentity = new Map<string, ProjectGroupHostMetrics>()
  const getProjectGroupHostMetrics = (identity: string): ProjectGroupHostMetrics => {
    const cached = projectGroupHostMetricsByIdentity.get(identity)
    if (cached) {
      return cached
    }
    const metrics: ProjectGroupHostMetrics = {
      count: 0,
      hostCounts: new Map(),
      hostWorktreeIds: new Map(),
      hostFolderWorkspaceIds: new Map(),
      worktreeIds: [],
      folderWorkspaceIds: []
    }
    const incrementHostCount = (hostId: ExecutionHostId, amount: number): void => {
      metrics.hostCounts.set(hostId, (metrics.hostCounts.get(hostId) ?? 0) + amount)
      if (!metrics.hostWorktreeIds.has(hostId)) {
        metrics.hostWorktreeIds.set(hostId, [])
      }
      if (!metrics.hostFolderWorkspaceIds.has(hostId)) {
        metrics.hostFolderWorkspaceIds.set(hostId, [])
      }
    }
    for (const [, entry] of groupByProjectGroupIdentity.get(identity) ?? []) {
      metrics.count += 1
      const entryHostIds = new Set<ExecutionHostId>()
      for (const worktree of entry.items) {
        const hostId = getWorktreeExecutionHostId(
          worktree,
          repoMap.get(worktree.repoId),
          defaultHostId
        )
        entryHostIds.add(hostId)
        const hostWorktreeIds = metrics.hostWorktreeIds.get(hostId) ?? []
        hostWorktreeIds.push(worktree.id)
        metrics.hostWorktreeIds.set(hostId, hostWorktreeIds)
        metrics.worktreeIds.push(worktree.id)
      }
      for (const repoId of entry.repoIds) {
        const entryRepo = repoMap.get(repoId)
        entryHostIds.add(
          entryRepo?.connectionId || entryRepo?.executionHostId
            ? getRepoExecutionHostId(entryRepo)
            : defaultHostId
        )
      }
      for (const hostId of entryHostIds) {
        incrementHostCount(hostId, 1)
      }
    }
    const projectGroup = projectGroupIndex.byIdentity.get(identity)
    for (const folderWorkspace of folderWorkspacesByProjectGroupIdentity.get(identity) ?? []) {
      metrics.count += 1
      const hostId = getFolderWorkspaceExecutionHostIdForRows({
        folderWorkspace,
        projectGroup,
        defaultHostId
      })
      incrementHostCount(hostId, 1)
      metrics.hostFolderWorkspaceIds.get(hostId)!.push(folderWorkspace.id)
      metrics.folderWorkspaceIds.push(folderWorkspace.id)
    }
    for (const child of childGroupsByParentIdentity.get(identity) ?? []) {
      const childMetrics = getProjectGroupHostMetrics(getProjectGroupSidebarIdentity(child))
      metrics.count += childMetrics.count
      for (const worktreeId of childMetrics.worktreeIds) {
        metrics.worktreeIds.push(worktreeId)
      }
      for (const folderWorkspaceId of childMetrics.folderWorkspaceIds) {
        metrics.folderWorkspaceIds.push(folderWorkspaceId)
      }
      for (const [hostId, count] of childMetrics.hostCounts) {
        incrementHostCount(hostId, count)
        const hostWorktreeIds = metrics.hostWorktreeIds.get(hostId)!
        for (const worktreeId of childMetrics.hostWorktreeIds.get(hostId) ?? []) {
          hostWorktreeIds.push(worktreeId)
        }
        const hostFolderWorkspaceIds = metrics.hostFolderWorkspaceIds.get(hostId)!
        for (const folderWorkspaceId of childMetrics.hostFolderWorkspaceIds.get(hostId) ?? []) {
          hostFolderWorkspaceIds.push(folderWorkspaceId)
        }
      }
    }
    if (metrics.hostCounts.size === 0 && projectGroup) {
      incrementHostCount(getProjectGroupExecutionHostIdForRows(projectGroup, defaultHostId), 0)
    }
    projectGroupHostMetricsByIdentity.set(identity, metrics)
    return metrics
  }

  const appendProjectGroup = (projectGroup: ProjectGroup, depth: number): void => {
    const identity = getProjectGroupSidebarIdentity(projectGroup)
    const ownerHostId = getProjectGroupOwnerHostId(projectGroup)
    const repoEntries = sortRepoEntriesWithinGroup(groupByProjectGroupIdentity.get(identity) ?? [])
    const childGroups = childGroupsByParentIdentity.get(identity) ?? []
    // Why: bare project-group:<id> stays when the bare id is unique; only same-id multi-owner rows need owner stamps.
    const keyOwner =
      projectGroupIndex.ambiguousIds.has(projectGroup.id) ||
      ownerQualifiedProjectGroupIds.has(projectGroup.id)
        ? ownerHostId
        : undefined
    const key = getProjectGroupHeaderKey(projectGroup.id, keyOwner)
    // Why: same-id groups on distinct owners collapse independently in persisted sidebar state.
    const collapseKey = getProjectGroupHeaderKey(projectGroup.id, keyOwner)
    const hostMetrics = getProjectGroupHostMetrics(identity)
    result.push({
      type: 'header',
      key,
      label: projectGroup.name,
      count: hostMetrics.count,
      tone: PROJECT_GROUP_META.tone,
      icon: PROJECT_GROUP_META.icon,
      projectGroup,
      projectGroupOwnerHostId: ownerHostId,
      collapseKey,
      projectGroupDepth: depth,
      hostWorktreeCounts: hostMetrics.hostCounts.size > 0 ? hostMetrics.hostCounts : undefined,
      hostWorktreeIds:
        hostMetrics.hostWorktreeIds.size > 0 ? hostMetrics.hostWorktreeIds : undefined,
      hostFolderWorkspaceIds:
        hostMetrics.hostFolderWorkspaceIds.size > 0
          ? hostMetrics.hostFolderWorkspaceIds
          : undefined,
      worktreeIds: hostMetrics.worktreeIds,
      folderWorkspaceIds: hostMetrics.folderWorkspaceIds
    })
    if (!collapsedGroups.has(collapseKey)) {
      for (const folderWorkspace of folderWorkspacesByProjectGroupIdentity.get(identity) ?? []) {
        result.push({
          type: 'folder-workspace',
          key: getFolderWorkspaceRowKey(
            folderWorkspace,
            [projectGroup],
            ambiguousFolderWorkspaceIds.has(folderWorkspace.id) ||
              ownerQualifiedFolderWorkspaceIds.has(folderWorkspace.id)
          ),
          folderWorkspace,
          projectGroup,
          depth: 0,
          groupDepth: depth + 1
        })
      }
      appendOrderedGroups(withRepoSectionDisplayLabels(repoEntries), depth + 1)
      for (const childGroup of childGroups) {
        appendProjectGroup(childGroup, depth + 1)
      }
    }
    groupByProjectGroupIdentity.delete(identity)
  }

  for (const projectGroup of childGroupsByParentIdentity.get(null) ?? []) {
    appendProjectGroup(projectGroup, 0)
  }

  const remainingRepoEntries = [...(groupByProjectGroupIdentity.get(null) ?? [])]
  for (const [projectGroupIdentity, entries] of groupByProjectGroupIdentity) {
    if (projectGroupIdentity === null || projectGroupIndex.byIdentity.has(projectGroupIdentity)) {
      continue
    }
    // Why: startup can have repos from hosts whose project-group metadata was
    // not fetched yet; missing metadata must not make those repos disappear.
    for (const entry of entries) {
      remainingRepoEntries.push(entry)
    }
  }
  appendOrderedGroups(
    withRepoSectionDisplayLabels(sortRepoEntriesWithinGroup(remainingRepoEntries)),
    0
  )

  return result
}

export function getGroupKeyForWorktree(
  groupBy: WorktreeGroupBy,
  worktree: Worktree,
  repoMap: Map<string, Repo>,
  prCache: Record<string, unknown> | null,
  workspaceStatuses: readonly WorkspaceStatusDefinition[] = cloneDefaultWorkspaceStatuses(),
  settings?: AppState['settings'],
  projectGrouping?: ProjectGroupingModel
): string | null {
  if (groupBy === 'none') {
    return ALL_GROUP_KEY
  }
  if (groupBy === 'workspace-status') {
    return getWorkspaceStatusGroupKey(getWorkspaceStatus(worktree, workspaceStatuses))
  }
  if (groupBy === 'repo') {
    return getProjectGroupingForRepo(
      worktree.repoId,
      repoMap,
      buildProjectGroupingIndex(projectGrouping)
    ).key
  }
  return `pr:${getPRGroupKey(worktree, repoMap, prCache, settings)}`
}

export function getGroupKeysForWorktree(
  groupBy: WorktreeGroupBy,
  worktree: Worktree,
  repoMap: Map<string, Repo>,
  prCache: Record<string, unknown> | null,
  workspaceStatuses: readonly WorkspaceStatusDefinition[] = cloneDefaultWorkspaceStatuses(),
  settings?: AppState['settings'],
  projectGroups: readonly ProjectGroup[] = [],
  projectGrouping?: ProjectGroupingModel
): string[] {
  const groupKey = getGroupKeyForWorktree(
    groupBy,
    worktree,
    repoMap,
    prCache,
    workspaceStatuses,
    settings,
    projectGrouping
  )
  if (!groupKey) {
    return []
  }
  if (groupBy !== 'repo') {
    return [groupKey]
  }
  const repo = repoMap.get(worktree.repoId)
  const groupKeys: string[] = []
  const projectGroupIndex = buildProjectGroupSidebarIndex(projectGroups)
  const visited = new Set<string>()
  let group = findProjectGroupForRepo(projectGroupIndex, repo, getRepoExecutionHostId(repo ?? {}))
  while (group) {
    const identity = getProjectGroupSidebarIdentity(group)
    if (visited.has(identity)) {
      break
    }
    visited.add(identity)
    const revealOwner = projectGroupIndex.ambiguousIds.has(group.id)
      ? getProjectGroupOwnerHostId(group)
      : undefined
    groupKeys.unshift(getProjectGroupHeaderKey(group.id, revealOwner))
    group = findProjectGroupParentForSidebar(projectGroupIndex, group)
  }
  return [...groupKeys, groupKey]
}
