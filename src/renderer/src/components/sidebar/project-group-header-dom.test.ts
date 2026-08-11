// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { getFolderWorkspaceRowKey } from '../../../../shared/folder-workspaces'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import type { FolderWorkspace, ProjectGroup, Repo, Worktree } from '../../../../shared/types'
import {
  buildRows,
  buildProjectGroupSidebarIndex,
  findProjectGroupForFolderWorkspace,
  findProjectGroupForRepo,
  findProjectGroupForSidebarOwner,
  getAmbiguousFolderWorkspaceSidebarIds,
  getProjectGroupMutationSelector,
  getProjectGroupSidebarIdentity,
  getSidebarWorktreeSelectionId,
  getSingleProjectGroupMutationOwner,
  hasSingleProjectGroupMutationOwner,
  parseProjectGroupSidebarHeaderKey
} from './worktree-list-groups'
import { addHostSectionRows } from './host-section-rows'
import { getRenderRowKey } from './worktree-list-virtual-rows'

function sidebarIdentityGroup(id: string, executionHostId: string): ProjectGroup {
  return {
    id,
    name: `${executionHostId}:${id}`,
    parentPath: null,
    executionHostId,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('project-group sidebar identity', () => {
  it('keeps bare folder row keys until owner qualification is required', () => {
    const workspace: FolderWorkspace = {
      id: 'same-id',
      projectGroupId: 'group-1',
      name: 'Runtime folder',
      folderPath: '/workspace',
      executionHostId: 'runtime:env-1',
      linkedTask: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0,
      createdAt: 1,
      updatedAt: 1
    }

    expect(getFolderWorkspaceRowKey(workspace)).toBe('folder-workspace:same-id')
    expect(getFolderWorkspaceRowKey(workspace, [], true)).toBe(
      'folder-workspace:runtime%3Aenv-1:same-id'
    )
  })

  it('resolves duplicate ids only with their catalog owner', () => {
    const local = sidebarIdentityGroup('same-id', 'local')
    const runtime = sidebarIdentityGroup('same-id', 'runtime:env-1')
    const index = buildProjectGroupSidebarIndex([local, runtime])

    expect(findProjectGroupForSidebarOwner(index, 'same-id')).toBeUndefined()
    expect(findProjectGroupForSidebarOwner(index, 'same-id', 'local')).toBe(local)
    expect(findProjectGroupForSidebarOwner(index, 'same-id', 'runtime:env-1')).toBe(runtime)
    expect(getProjectGroupSidebarIdentity(local)).not.toBe(getProjectGroupSidebarIdentity(runtime))
  })

  it('renders a legacy SSH folder under its unambiguous local-stamped Project Group', () => {
    const group: ProjectGroup = {
      ...sidebarIdentityGroup('group-root', 'local'),
      name: 'Platform',
      parentPath: '/monorepo',
      createdFrom: 'folder-scan'
    }
    const folderWorkspace: FolderWorkspace = {
      id: 'folder-workspace-1',
      projectGroupId: group.id,
      name: 'Refund fix',
      folderPath: '/monorepo',
      connectionId: 'builder',
      executionHostId: 'ssh:builder',
      linkedTask: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 10,
      lastActivityAt: 0,
      createdAt: 1,
      updatedAt: 1
    }

    const rows = buildRows(
      'repo',
      [],
      new Map(),
      null,
      new Set(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      [group],
      new Set(),
      new Map(),
      new Map(),
      [],
      undefined,
      [folderWorkspace]
    )

    expect(rows).toMatchObject([
      { type: 'header', key: 'project-group:group-root', count: 1 },
      {
        type: 'folder-workspace',
        folderWorkspace: { id: 'folder-workspace-1' },
        projectGroup: { id: 'group-root' },
        groupDepth: 1
      }
    ])
    const collidingGroup = { ...group, executionHostId: 'runtime:env-1' }
    expect(
      findProjectGroupForFolderWorkspace(
        buildProjectGroupSidebarIndex([group, collidingGroup]),
        folderWorkspace
      )
    ).toBeUndefined()
  })

  it('keeps folder-backed card geometry scoped to the repo owner', () => {
    const local = { ...sidebarIdentityGroup('same-id', 'local'), createdFrom: 'manual' as const }
    const runtime = {
      ...sidebarIdentityGroup('same-id', 'runtime:env-1'),
      createdFrom: 'folder-scan' as const
    }
    const index = buildProjectGroupSidebarIndex([local, runtime])

    expect(findProjectGroupForRepo(index, ownerHeaderRepo('local-repo', 'local'), 'local')).toBe(
      local
    )
    expect(
      findProjectGroupForRepo(index, ownerHeaderRepo('runtime-repo', 'runtime:env-1'), 'local')
    ).toBe(runtime)
  })

  it('carries the exact owner from a rendered header into mutations', () => {
    const runtime = sidebarIdentityGroup('same-id', 'runtime:env-1')

    expect(getProjectGroupMutationSelector(runtime)).toEqual({
      groupId: 'same-id',
      ownerHostId: 'runtime:env-1'
    })
    expect(parseProjectGroupSidebarHeaderKey('project-group:runtime%3Aenv-1:same-id')).toEqual({
      groupId: 'same-id',
      ownerHostId: 'runtime:env-1'
    })
  })

  it('marks folder row ids ambiguous only across owners', () => {
    const local = sidebarIdentityGroup('local-group', 'local')
    const runtime = sidebarIdentityGroup('runtime-group', 'runtime:env-1')
    const index = buildProjectGroupSidebarIndex([local, runtime])

    expect(
      getAmbiguousFolderWorkspaceSidebarIds(index, [
        { id: 'same-id', projectGroupId: local.id, executionHostId: 'local' },
        { id: 'same-id', projectGroupId: runtime.id, executionHostId: 'runtime:env-1' },
        { id: 'unique-id', projectGroupId: runtime.id, executionHostId: 'runtime:env-1' }
      ])
    ).toEqual(new Set(['same-id']))
  })

  it('keeps same-id folder selection distinct across owners', () => {
    const local = folderWorkspaceToWorktree({
      id: 'same-id',
      projectGroupId: 'same-group',
      name: 'Local',
      folderPath: '/local',
      executionHostId: 'local',
      linkedTask: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0,
      createdAt: 1,
      updatedAt: 1
    })
    const runtime = { ...local, hostId: 'runtime:env-1' as const }

    expect(getSidebarWorktreeSelectionId(local, undefined, 'local')).not.toBe(
      getSidebarWorktreeSelectionId(runtime, undefined, 'local')
    )
  })

  it('does not fall back to a foreign group for an explicit stale owner', () => {
    const local = sidebarIdentityGroup('same-id', 'local')
    const index = buildProjectGroupSidebarIndex([local])

    expect(findProjectGroupForSidebarOwner(index, 'same-id', 'runtime:missing')).toBeUndefined()
  })

  it('disables focused-host mutations for mixed-owner and mismatched lists', () => {
    const localA = sidebarIdentityGroup('a', 'local')
    const localB = sidebarIdentityGroup('b', 'local')
    const runtime = sidebarIdentityGroup('c', 'runtime:env-1')

    expect(hasSingleProjectGroupMutationOwner([localA, localB], 'local')).toBe(true)
    expect(hasSingleProjectGroupMutationOwner([localA, localB], 'runtime:env-1')).toBe(false)
    expect(hasSingleProjectGroupMutationOwner([localA, runtime], 'local')).toBe(false)
  })

  it('allows header reorder after filtering duplicate ids to one owner', () => {
    const local = sidebarIdentityGroup('same-id', 'local')
    const runtime = sidebarIdentityGroup('same-id', 'runtime:env-1')

    expect(getSingleProjectGroupMutationOwner([local, runtime])).toBeNull()
    expect(getSingleProjectGroupMutationOwner([runtime])).toBe('runtime:env-1')
  })
})

function ownerHeaderGroup(ownerHostId: ExecutionHostId): ProjectGroup {
  return {
    id: 'same-id',
    name: `${ownerHostId} group`,
    parentPath: `/${ownerHostId}`,
    executionHostId: ownerHostId,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  }
}

function ownerHeaderRepo(id: string, ownerHostId: ExecutionHostId): Repo {
  return {
    id,
    path: `/${id}`,
    displayName: id,
    badgeColor: '#000',
    addedAt: 1,
    projectGroupId: 'same-id',
    projectGroupOrder: 0,
    executionHostId: ownerHostId
  }
}

function ownerHeaderWorktree(id: string, repoId: string): Worktree {
  return {
    id,
    repoId,
    path: `/${repoId}/${id}`,
    head: 'abc',
    branch: `refs/heads/${id}`,
    isBare: false,
    isMainWorktree: true,
    displayName: id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0
  }
}

function buildOwnerRows(
  owners: readonly ExecutionHostId[],
  collapsed = new Set<string>(),
  ownerQualifiedProjectGroupIds = new Set(['same-id']),
  folderWorkspaces: readonly FolderWorkspace[] = [],
  ownerQualifiedFolderWorkspaceIds = new Set<string>()
) {
  const groups = owners.map(ownerHeaderGroup)
  const repos = owners.map((owner, index) => ownerHeaderRepo(`repo-${index}`, owner))
  return buildRows(
    'repo',
    repos.map((project, index) => ownerHeaderWorktree(`wt-${index}`, project.id)),
    new Map(repos.map((project) => [project.id, project])),
    null,
    collapsed,
    undefined,
    undefined,
    'manual',
    undefined,
    undefined,
    false,
    undefined,
    groups,
    new Set(),
    new Map(),
    new Map(),
    [],
    undefined,
    folderWorkspaces,
    undefined,
    'local',
    undefined,
    ownerQualifiedProjectGroupIds,
    ownerQualifiedFolderWorkspaceIds
  )
}

function projectGroupHeaderKeys(rows: ReturnType<typeof buildOwnerRows>): string[] {
  return rows.flatMap((row) =>
    row.type === 'header' && row.projectGroup && !row.repo ? [row.key] : []
  )
}

describe('duplicate project-group header identity (#12532)', () => {
  it('keeps an empty owner-scoped group in its zero-count host section', () => {
    const localRepo = ownerHeaderRepo('local-repo', 'local')
    const sshRepo = ownerHeaderRepo('ssh-repo', 'ssh:builder')
    const emptyGroup = ownerHeaderGroup('runtime:env-1')
    const rows: ReturnType<typeof buildOwnerRows> = [
      {
        type: 'header',
        key: 'repo:local-repo',
        label: 'Local',
        count: 1,
        tone: 'text-foreground',
        repo: localRepo
      },
      {
        type: 'item',
        rowKey: 'repo:local-repo:local-wt',
        sectionKey: 'repo:local-repo',
        worktree: ownerHeaderWorktree('local-wt', localRepo.id),
        repo: localRepo,
        depth: 0,
        groupDepth: 0,
        lineageTrail: [],
        isLastLineageChild: true,
        lineageChildCount: 0
      },
      {
        type: 'header',
        key: 'repo:ssh-repo',
        label: 'SSH',
        count: 1,
        tone: 'text-foreground',
        repo: sshRepo
      },
      {
        type: 'item',
        rowKey: 'repo:ssh-repo:ssh-wt',
        sectionKey: 'repo:ssh-repo',
        worktree: ownerHeaderWorktree('ssh-wt', sshRepo.id),
        repo: sshRepo,
        depth: 0,
        groupDepth: 0,
        lineageTrail: [],
        isLastLineageChild: true,
        lineageChildCount: 0
      },
      {
        type: 'header',
        key: 'project-group:runtime%3Aenv-1:same-id',
        label: emptyGroup.name,
        count: 0,
        tone: 'text-foreground',
        projectGroup: emptyGroup,
        projectGroupOwnerHostId: 'runtime:env-1',
        hostWorktreeCounts: new Map([['runtime:env-1', 0]])
      }
    ]

    const sectioned = addHostSectionRows({
      rows,
      hostOptions: [
        { id: 'local', kind: 'local', label: 'Local', detail: '', health: 'local' },
        {
          id: 'ssh:builder',
          kind: 'ssh',
          label: 'Builder',
          detail: '',
          health: 'available'
        },
        {
          id: 'runtime:env-1',
          kind: 'runtime',
          label: 'Runtime',
          detail: '',
          health: 'available'
        }
      ],
      workspaceHostScope: 'all',
      defaultHostId: 'local'
    })

    expect(sectioned).toContainEqual(
      expect.objectContaining({
        type: 'header',
        key: 'project-group:runtime%3Aenv-1:same-id',
        count: 0,
        hostId: 'runtime:env-1'
      })
    )
    expect(sectioned).toContainEqual(
      expect.objectContaining({ type: 'host-header', hostId: 'runtime:env-1', count: 0 })
    )
  })

  it('keeps cold-render and virtualizer identities distinct across owners', () => {
    const rows = buildOwnerRows(['local', 'runtime:env-1'])

    expect(projectGroupHeaderKeys(rows)).toEqual([
      'project-group:local:same-id',
      'project-group:runtime%3Aenv-1:same-id'
    ])
    const renderKeys = rows.map(getRenderRowKey)
    expect(new Set(renderKeys).size).toBe(renderKeys.length)
  })

  it('collapses only the selected owner and stays unique after rebuild', () => {
    const collapsed = new Set(['project-group:runtime%3Aenv-1:same-id'])
    const rows = buildOwnerRows(['local', 'runtime:env-1'], collapsed)

    expect(projectGroupHeaderKeys(rows)).toEqual([
      'project-group:local:same-id',
      'project-group:runtime%3Aenv-1:same-id'
    ])
    expect(rows.filter((row) => row.type === 'item')).toHaveLength(1)
    const renderKeys = rows.map(getRenderRowKey)
    expect(new Set(renderKeys).size).toBe(renderKeys.length)
  })

  it('keeps a host-filter rebuild owner-qualified without disabling the visible owner', () => {
    const rows = buildOwnerRows(['runtime:env-1'])

    expect(projectGroupHeaderKeys(rows)).toEqual(['project-group:runtime%3Aenv-1:same-id'])
    const renderKeys = rows.map(getRenderRowKey)
    expect(new Set(renderKeys).size).toBe(renderKeys.length)
  })

  it('keeps a collision-qualified folder key after filtering to one owner', () => {
    const runtimeFolder: FolderWorkspace = {
      id: 'same-folder',
      projectGroupId: 'same-id',
      name: 'Runtime folder',
      folderPath: '/runtime/folder',
      executionHostId: 'runtime:env-1',
      linkedTask: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0,
      createdAt: 1,
      updatedAt: 1
    }
    const rows = buildOwnerRows(
      ['runtime:env-1'],
      new Set(),
      new Set(['same-id']),
      [runtimeFolder],
      new Set(['same-folder'])
    )

    const folderRow = rows.find((row) => row.type === 'folder-workspace')
    expect(folderRow?.key).toBe('folder-workspace:runtime%3Aenv-1:same-folder')
    expect(folderRow && getRenderRowKey(folderRow)).toBe(
      'folder-workspace:runtime%3Aenv-1:same-folder'
    )
  })
})

const worktreeListStore = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))

type WorktreeListComponent = React.ComponentType<{
  scrollOffsetRef: React.RefObject<number>
  scrollAnchorRef: React.RefObject<unknown>
}>

let WorktreeList: WorktreeListComponent

vi.mock('@/store', () => {
  const useAppStore = ((selector: (state: Record<string, unknown>) => unknown) =>
    selector(worktreeListStore.state)) as ((
    selector: (state: Record<string, unknown>) => unknown
  ) => unknown) & { getState: () => Record<string, unknown> }
  useAppStore.getState = () => worktreeListStore.state
  return { useAppStore }
})

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: ({ startIndex, endIndex }: { startIndex: number; endIndex: number }) =>
    Array.from({ length: endIndex - startIndex + 1 }, (_, index) => startIndex + index),
  measureElement: () => 32,
  useVirtualizer: ({ count }: { count: number }) => ({
    elementsCache: new Map(),
    getTotalSize: () => count * 96,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: `row-${index}`,
        start: index * 96
      })),
    measureElement: vi.fn(),
    scrollToIndex: vi.fn()
  })
}))

vi.mock('@/hooks/useVirtualizedScrollAnchor', () => ({
  VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT: 'orca:test-record-scroll-anchor',
  useVirtualizedScrollAnchor: vi.fn()
}))

vi.mock('./project-header-drag', () => ({
  useRepoHeaderDrag: () => ({
    state: { draggingRepoId: null, dropIndicatorY: null },
    onHandlePointerDown: vi.fn()
  }),
  isRepoHeaderActionTarget: () => false
}))

function childrenOnly({ children }: { children: ReactNode }): ReactNode {
  return children
}

vi.mock('@/components/ui/hover-card', () => ({
  HoverCard: childrenOnly,
  HoverCardContent: childrenOnly,
  HoverCardTrigger: childrenOnly
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: childrenOnly,
  TooltipContent: childrenOnly,
  TooltipTrigger: childrenOnly
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: childrenOnly,
  DropdownMenuContent: childrenOnly,
  DropdownMenuItem: childrenOnly,
  DropdownMenuSeparator: () => null,
  DropdownMenuSub: childrenOnly,
  DropdownMenuSubContent: childrenOnly,
  DropdownMenuSubTrigger: childrenOnly,
  DropdownMenuTrigger: childrenOnly
}))

vi.mock('@/lib/sidebar-worktree-activation', () => ({ activateWorktreeFromSidebar: vi.fn() }))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', () => ({
  getActiveRuntimeTarget: () => ({ kind: 'local' }),
  callRuntimeRpc: vi.fn()
}))
vi.mock('./WorktreeCardAgents', () => ({
  default: () => null,
  SUPPRESS_WORKTREE_LIST_SCROLL_ADJUSTMENT_EVENT: 'orca:test-suppress-scroll-adjustment'
}))
vi.mock('./WorktreeCard', () => ({
  default: ({ worktree }: { worktree: Worktree }) =>
    createElement('div', { 'data-mock-worktree-card': worktree.id }, worktree.displayName)
}))

function hostFilteredProjectGroup(): ProjectGroup {
  return {
    id: 'runtime-group',
    name: 'Runtime project group',
    parentPath: '/srv/runtime-project',
    executionHostId: 'runtime:env-1',
    parentGroupId: null,
    createdFrom: 'folder-scan',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  }
}

function hostFilteredFolderWorkspace(): FolderWorkspace {
  return {
    id: 'runtime-folder',
    projectGroupId: 'runtime-group',
    name: 'Runtime folder workspace',
    folderPath: '/srv/runtime-project/task',
    executionHostId: 'runtime:env-1',
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1
  }
}

function setHostFilteredWorktreeListState(folderWorkspaces: FolderWorkspace[]): void {
  worktreeListStore.state = {
    activeModal: '',
    activeView: 'terminal',
    activeWorkspaceExecutionHostId: null,
    activeWorkspaceKey: null,
    activeWorktreeId: null,
    agentSendPopoverTargetMode: null,
    agentStatusByPaneKey: {},
    agentStatusEpoch: 0,
    alwaysShowDefaultBranchWorkspace: true,
    browserTabsByWorktree: {},
    clearPendingRevealSidebarRow: vi.fn(),
    clearPendingRevealWorktreeId: vi.fn(),
    collapsedGroups: new Set<string>(),
    deleteStateByWorktreeId: {},
    detectedWorktreesByRepo: {},
    fetchFolderWorkspacePathStatus: vi.fn(),
    fetchHostedReviewForBranch: vi.fn(),
    fetchIssue: vi.fn(),
    fetchLinearIssue: vi.fn(),
    filterRepoIds: [],
    folderWorkspacePathStatuses: {},
    folderWorkspaces,
    getFolderWorkspacePathStatusCacheKey: (request: unknown) => JSON.stringify(request),
    getFreshFolderWorkspacePathStatus: vi.fn(() => null),
    gitConflictOperationByWorktreeId: {},
    groupBy: 'repo',
    hideAutomationGeneratedWorkspaces: false,
    hideCliCreatedWorkspaces: false,
    hideDefaultBranchWorkspace: false,
    hideDetachedHeadWorkspaces: false,
    hostedReviewCache: {},
    issueCache: {},
    linearIssueCache: {},
    linearStatus: null,
    migrationUnsupportedByPtyId: {},
    openModal: vi.fn(),
    openSettingsPage: vi.fn(),
    openSettingsTarget: null,
    openTaskPage: vi.fn(),
    pendingRevealSidebarRow: null,
    pendingRevealWorktree: null,
    prCache: {},
    projectGroups: [hostFilteredProjectGroup()],
    projectOrderBy: 'manual',
    ptyIdsByTabId: {},
    recordFeatureInteraction: vi.fn(),
    remoteBranchConflictByWorktreeId: {},
    reorderRepos: vi.fn(),
    reportVisibleGitHubPRRefreshCandidates: vi.fn(),
    repos: [],
    retainedAgentsByPaneKey: {},
    revealSidebarRow: vi.fn(),
    revealWorktreeInSidebar: vi.fn(),
    runtimeEnvironments: [{ id: 'env-1', name: 'Runtime host' }],
    runtimePaneTitlesByTabId: {},
    runtimeStatusByEnvironmentId: new Map(),
    setAlwaysShowDefaultBranchWorkspace: vi.fn(),
    setFilterRepoIds: vi.fn(),
    setGroupBy: vi.fn(),
    setHideAutomationGeneratedWorkspaces: vi.fn(),
    setHideCliCreatedWorkspaces: vi.fn(),
    setHideDefaultBranchWorkspace: vi.fn(),
    setHideDetachedHeadWorkspaces: vi.fn(),
    setRenamingWorktreeId: vi.fn(),
    setShowSleepingWorkspaces: vi.fn(),
    setSortBy: vi.fn(),
    setVisibleWorkspaceHostIds: vi.fn(),
    setWorkspaceHostOrder: vi.fn(),
    setWorktreesPinnedAndReveal: vi.fn(),
    settings: null,
    showSleepingWorkspaces: true,
    sortBy: 'manual',
    sortEpoch: 0,
    sshConnectedGeneration: 0,
    sshConnectionStates: new Map(),
    sshTargetLabels: new Map(),
    tabsByWorktree: {},
    terminalLayoutsByTabId: {},
    toggleCollapsedGroup: vi.fn(),
    updateProjectGroup: vi.fn(),
    updateRepo: vi.fn(),
    updateWorktreeMeta: vi.fn(),
    updateWorktreesMeta: vi.fn(),
    visibleWorkspaceHostIds: ['runtime:env-1'],
    workspaceHostOrder: [],
    workspaceHostScope: 'all',
    workspaceLineageByChildKey: {},
    workspacePortScan: null,
    workspaceStatuses: [],
    worktreeCardProperties: ['status', 'pr', 'comment'],
    worktreeLineageById: {},
    worktreesByRepo: {}
  }
}

const mountedWorktreeListRoots: Root[] = []

async function renderHostFilteredWorktreeList(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedWorktreeListRoots.push(root)
  await act(async () => {
    root.render(
      createElement(WorktreeList, {
        scrollOffsetRef: { current: 0 },
        scrollAnchorRef: { current: null }
      })
    )
  })
  return container
}

describe('WorktreeList project-group host filtering', () => {
  beforeAll(async () => {
    WorktreeList = (await import('./WorktreeList')).default as WorktreeListComponent
  }, 60_000)

  beforeEach(() => vi.clearAllMocks())

  afterEach(async () => {
    await act(async () => {
      for (const root of mountedWorktreeListRoots.splice(0)) {
        root.unmount()
      }
    })
    document.body.innerHTML = ''
  })

  it.each([
    ['zero-count', []],
    ['folder-only', [hostFilteredFolderWorkspace()]]
  ] as const)('keeps the selected-host %s owner group visible', async (_case, workspaces) => {
    setHostFilteredWorktreeListState([...workspaces])

    const container = await renderHostFilteredWorktreeList()

    expect(container.textContent).toContain('Runtime project group')
    expect(container.textContent).not.toContain('No workspaces found')
  })

  it('keeps a selected-host folder-only owner group visible under workspace filters', async () => {
    setHostFilteredWorktreeListState([hostFilteredFolderWorkspace()])
    worktreeListStore.state = {
      ...worktreeListStore.state,
      hideDefaultBranchWorkspace: true
    }

    const container = await renderHostFilteredWorktreeList()

    expect(container.textContent).toContain('Runtime project group')
    expect(container.textContent).toContain('Runtime folder workspace')
    expect(container.textContent).not.toContain('No workspaces found')
  })

  it('still lets a workspace filter replace empty project-group headers', async () => {
    setHostFilteredWorktreeListState([])
    worktreeListStore.state = {
      ...worktreeListStore.state,
      hideDefaultBranchWorkspace: true
    }

    const container = await renderHostFilteredWorktreeList()

    expect(container.textContent).toContain('No workspaces found')
    expect(container.textContent).not.toContain('Runtime project group')
  })
})
