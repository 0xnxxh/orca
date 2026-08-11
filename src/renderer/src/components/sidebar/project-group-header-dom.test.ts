import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { getFolderWorkspaceRowKey } from '../../../../shared/folder-workspaces'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import type { FolderWorkspace, ProjectGroup, Repo, Worktree } from '../../../../shared/types'
import {
  buildRows,
  buildProjectGroupSidebarIndex,
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

function readWorktreeListSource(): string {
  return readFileSync(fileURLToPath(new URL('./WorktreeList.tsx', import.meta.url)), 'utf8')
}

function readComposerStateSource(): string {
  return readFileSync(
    fileURLToPath(new URL('../../hooks/useComposerState.ts', import.meta.url)),
    'utf8'
  )
}

describe('Project Group header drag DOM source', () => {
  it('renders concrete Project Group header drag attributes separately from repo headers', () => {
    const source = readWorktreeListSource()

    expect(source).toContain('data-project-group-header-id={projectGroupIdForHeader}')
    expect(source).toContain('data-project-group-header-index={projectGroupHeaderIndex}')
    expect(source).toContain('data-project-group-header-bucket={projectGroupHeaderBucketKey}')
    expect(source).toContain('data-project-group-header-drag-handle=')
  })

  it('commits Project Group manual sorting through updateProjectGroup tabOrder', () => {
    const source = readWorktreeListSource()

    expect(source).toContain('const updateProjectGroup = useAppStore((s) => s.updateProjectGroup)')
    expect(source).toContain('ownerHostId: getProjectGroupMutationSelector(group).ownerHostId')
  })

  it('routes folder DOM identity and active styling through the exact owner row', () => {
    const source = readWorktreeListSource()

    expect(source).toContain('id={getWorktreeOptionId(folderSidebarRowKey)}')
    expect(source).toContain('data-worktree-row-key={folderSidebarRowKey}')
    expect(source).toContain('activationRowKey={folderSidebarRowKey}')
    expect(source).toContain('aria-current={isFolderWorkspaceActive')
    expect(source).toContain('activeWorkspaceExecutionHostId === folderOwnerHostId')
  })

  it('checks Reveal Current visibility with owner-qualified selection identity', () => {
    const source = readWorktreeListSource()
    const revealStart = source.indexOf('const handleRevealCurrentWorkspaceRequest')
    const revealEnd = source.indexOf('useEffect(() => {', revealStart)
    const revealSource = source.slice(revealStart, revealEnd)

    expect(revealSource).toContain('getSidebarWorktreeSelectionId(')
    expect(revealSource).toContain('renderedWorktreeSelectionIds.includes(')
    expect(revealSource).not.toContain('renderedWorktreeIds.includes(')
  })

  it('persists and restores a draft project group through its existing host field', () => {
    const source = readComposerStateSource()
    const restoreStart = source.indexOf('const initialFolderProjectGroupId')
    const restoreEnd = source.indexOf('const isProjectGroupTarget', restoreStart)
    const persistStart = source.indexOf('// Persist draft whenever relevant fields change')
    const persistEnd = source.indexOf('// Auto-pick the first eligible repo', persistStart)

    expect(source.slice(restoreStart, restoreEnd)).toContain('draftHostId')
    expect(source.slice(persistStart, persistEnd)).toContain('selectedProjectGroupOwnerHostId')
  })

  it('keeps grab cursor on the title surface and dual handle attrs on row + surface', () => {
    // Why: lock the cursor/hit-test split so a cleanup does not put grab back on the whole row
    // or drop row-level handle attrs that arm drag from indent/padding.
    const source = readWorktreeListSource()
    const headerBlockStart = source.indexOf('data-repo-header-id={projectIdForHeader}')
    const headerBlockEnd = source.indexOf('<ProjectHeaderActions>', headerBlockStart)
    expect(headerBlockStart).toBeGreaterThan(-1)
    expect(headerBlockEnd).toBeGreaterThan(headerBlockStart)
    const headerBlock = source.slice(headerBlockStart, headerBlockEnd)

    // Dual handle placement: row (indent/padding) + title surface.
    expect(headerBlock.match(/data-repo-header-drag-handle=/g)?.length).toBe(2)
    expect(headerBlock.match(/data-project-group-header-drag-handle=/g)?.length).toBe(2)
    // Surface owns grab; outer row only gets cursor-pointer when not draggable.
    expect(headerBlock).toContain(
      "!(isDraggableRepoHeader || isDraggableProjectGroupHeader) && 'cursor-pointer'"
    )
    expect(headerBlock).toContain("'flex min-w-0 flex-1 items-center gap-1.5 self-stretch'")
    expect(headerBlock).toContain("'cursor-grab active:cursor-grabbing'")
    // Row-level ternary grab must stay gone.
    expect(headerBlock).not.toMatch(
      /isDraggableRepoHeader \|\| isDraggableProjectGroupHeader\s*\?\s*'cursor-grab/
    )
  })
})

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
