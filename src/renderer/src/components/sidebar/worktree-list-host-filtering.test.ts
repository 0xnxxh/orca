import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FolderWorkspace, ProjectGroup, Repo, Worktree } from '../../../../shared/types'
import { addHostSectionRows } from './host-section-rows'
import { buildRows, type Row } from './worktree-list-groups'
import {
  filterFolderWorkspacesForVisibleHosts,
  filterProjectGroupsForVisibleHosts,
  getFolderPathStatusRouteOptionsForRows,
  getFolderWorkspaceExecutionHostIdForRows,
  getProjectGroupExecutionHostIdForRows,
  getRuntimeEnvironmentIdForFolderPathStatusHost
} from './worktree-list-host-filtering'

function readWorktreeListSource(): string {
  return readFileSync(
    join(process.cwd(), 'src', 'renderer', 'src', 'components', 'sidebar', 'WorktreeList.tsx'),
    'utf8'
  )
}

function readComposerStateSource(): string {
  return readFileSync(
    join(process.cwd(), 'src', 'renderer', 'src', 'hooks', 'useComposerState.ts'),
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
    expect(source).toContain('id: folderWorkspaceKey(')
    expect(source).toContain(
      'ambiguousFolderWorkspaceIds.has(folderWorkspaceRow.folderWorkspace.id)'
    )
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
    const source = readWorktreeListSource()
    const headerBlockStart = source.indexOf('data-repo-header-id={projectIdForHeader}')
    const headerBlockEnd = source.indexOf('<ProjectHeaderActions>', headerBlockStart)
    expect(headerBlockStart).toBeGreaterThan(-1)
    expect(headerBlockEnd).toBeGreaterThan(headerBlockStart)
    const headerBlock = source.slice(headerBlockStart, headerBlockEnd)

    expect(headerBlock.match(/data-repo-header-drag-handle=/g)?.length).toBe(2)
    expect(headerBlock.match(/data-project-group-header-drag-handle=/g)?.length).toBe(2)
    expect(headerBlock).toContain(
      "!(isDraggableRepoHeader || isDraggableProjectGroupHeader) && 'cursor-pointer'"
    )
    expect(headerBlock).toContain("'flex min-w-0 flex-1 items-center gap-1.5 self-stretch'")
    expect(headerBlock).toContain("'cursor-grab active:cursor-grabbing'")
    expect(headerBlock).not.toMatch(
      /isDraggableRepoHeader \|\| isDraggableProjectGroupHeader\s*\?\s*'cursor-grab/
    )
  })
})

function group(overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    id: 'group-1',
    name: 'Runtime group',
    parentPath: '/srv/app',
    connectionId: null,
    executionHostId: null,
    parentGroupId: null,
    createdFrom: 'folder-scan',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function folderWorkspace(overrides: Partial<FolderWorkspace> = {}): FolderWorkspace {
  return {
    id: 'folder-1',
    projectGroupId: 'group-1',
    name: 'Runtime folder',
    folderPath: '/srv/app/task',
    connectionId: null,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('WorktreeList host filtering ownership', () => {
  it('uses runtime execution host stamps before SSH/default fallbacks for project groups', () => {
    expect(
      getProjectGroupExecutionHostIdForRows(
        group({ connectionId: 'ssh-builder', executionHostId: 'runtime:env-1' }),
        'local'
      )
    ).toBe('runtime:env-1')
  })

  it('uses the project group runtime owner for folder workspaces in that group', () => {
    expect(
      getFolderWorkspaceExecutionHostIdForRows({
        folderWorkspace: folderWorkspace({ connectionId: 'ssh-builder' }),
        projectGroup: group({ connectionId: 'ssh-builder', executionHostId: 'runtime:env-1' }),
        defaultHostId: 'local'
      })
    ).toBe('runtime:env-1')
  })

  it('keeps explicit runtime group ownership when the focused runtime is the same host', () => {
    expect(
      getFolderWorkspaceExecutionHostIdForRows({
        folderWorkspace: folderWorkspace({ connectionId: 'ssh-builder' }),
        projectGroup: group({ connectionId: 'ssh-builder', executionHostId: 'runtime:env-1' }),
        defaultHostId: 'runtime:env-1'
      })
    ).toBe('runtime:env-1')
  })

  it('uses legacy SSH folder ownership over a local-stamped group', () => {
    expect(
      getFolderWorkspaceExecutionHostIdForRows({
        folderWorkspace: folderWorkspace({ connectionId: 'builder' }),
        projectGroup: group({ connectionId: undefined, executionHostId: 'local' }),
        defaultHostId: 'runtime:env-1'
      })
    ).toBe('ssh:builder')
  })

  it('extracts runtime route ids for folder path status requests', () => {
    expect(getRuntimeEnvironmentIdForFolderPathStatusHost('runtime:env-1')).toBe('env-1')
    expect(getRuntimeEnvironmentIdForFolderPathStatusHost('ssh:ssh-builder')).toBeNull()
    expect(getRuntimeEnvironmentIdForFolderPathStatusHost('local')).toBeNull()
  })

  it('filters same-id legacy folders through their exact project-group owner', () => {
    const localGroup = group({ id: 'same-group', executionHostId: 'local' })
    const runtimeGroup = group({ id: 'same-group', executionHostId: 'runtime:env-1' })
    const localFolder = folderWorkspace({
      id: 'same-folder',
      projectGroupId: localGroup.id,
      connectionId: null
    })
    const runtimeFolder = folderWorkspace({
      id: 'same-folder',
      projectGroupId: runtimeGroup.id,
      executionHostId: 'runtime:env-1'
    })

    expect(
      filterFolderWorkspacesForVisibleHosts(
        [localFolder, runtimeFolder],
        [localGroup, runtimeGroup],
        new Set(['local']),
        'local'
      )
    ).toEqual([localFolder])
  })

  it('routes project-group path status through the owning runtime', () => {
    const runtimeGroup = group({ executionHostId: 'runtime:env-1' })
    expect(
      getFolderPathStatusRouteOptionsForRows({
        request: { scope: 'project-group', projectGroupId: runtimeGroup.id },
        projectGroupsById: new Map([[runtimeGroup.id, runtimeGroup]]),
        folderWorkspacesById: new Map()
      })
    ).toEqual({ runtimeEnvironmentId: 'env-1' })
  })

  it('routes duplicate project-group ids from the request owner', () => {
    const localGroup = group({ id: 'same-id' })

    expect(
      getFolderPathStatusRouteOptionsForRows({
        request: {
          scope: 'project-group',
          projectGroupId: 'same-id',
          ownerHostId: 'runtime:env-1'
        },
        projectGroupsById: new Map([[localGroup.id, localGroup]]),
        folderWorkspacesById: new Map()
      })
    ).toEqual({ runtimeEnvironmentId: 'env-1' })
  })

  it('routes folder-workspace path status through its project group runtime owner', () => {
    const runtimeGroup = group({ executionHostId: 'runtime:env-1' })
    const workspace = folderWorkspace({ connectionId: 'ssh-builder' })
    expect(
      getFolderPathStatusRouteOptionsForRows({
        request: { scope: 'folder-workspace', folderWorkspaceId: workspace.id },
        projectGroupsById: new Map([[runtimeGroup.id, runtimeGroup]]),
        folderWorkspacesById: new Map([[workspace.id, workspace]])
      })
    ).toEqual({ runtimeEnvironmentId: 'env-1' })
  })

  it('forces local path status routing for local project groups while a runtime is focused', () => {
    const localGroup = group()
    expect(
      getFolderPathStatusRouteOptionsForRows({
        request: { scope: 'project-group', projectGroupId: localGroup.id },
        projectGroupsById: new Map([[localGroup.id, localGroup]]),
        folderWorkspacesById: new Map()
      })
    ).toEqual({ runtimeEnvironmentId: null })
  })

  it('forces local path status routing for SSH-owned project groups while a runtime is focused', () => {
    const sshGroup = group({ connectionId: 'ssh-builder' })
    expect(
      getFolderPathStatusRouteOptionsForRows({
        request: { scope: 'project-group', projectGroupId: sshGroup.id },
        projectGroupsById: new Map([[sshGroup.id, sshGroup]]),
        folderWorkspacesById: new Map()
      })
    ).toEqual({ runtimeEnvironmentId: null })
  })
})

describe('runtime folder host section rows', () => {
  it('keeps a runtime-stamped folder under its host after a filter rebuild', () => {
    const runtimeGroup = group({
      id: 'group-1',
      name: 'Remote folder',
      executionHostId: 'runtime:env-2'
    })
    const runtimeFolder = folderWorkspace({
      id: 'folder-1',
      projectGroupId: runtimeGroup.id,
      name: 'Runtime workspace',
      folderPath: '/workspace',
      executionHostId: 'runtime:env-2'
    })
    const localGroup = group({
      id: 'local-group',
      name: 'Local folder',
      executionHostId: 'local'
    })
    const localFolder = folderWorkspace({
      id: 'local-folder',
      projectGroupId: localGroup.id,
      name: 'Local workspace',
      folderPath: '/workspace',
      executionHostId: 'local'
    })
    const rows: Row[] = [
      {
        type: 'folder-workspace',
        key: 'folder-workspace:@owner:local:local-folder',
        folderWorkspace: localFolder,
        projectGroup: localGroup,
        depth: 0,
        groupDepth: 0
      },
      {
        type: 'folder-workspace',
        key: 'folder-workspace:@owner:runtime%3Aenv-2:folder-1',
        folderWorkspace: runtimeFolder,
        projectGroup: runtimeGroup,
        depth: 0,
        groupDepth: 0
      }
    ]

    const sectioned = addHostSectionRows({
      rows,
      hostOptions: [
        {
          id: 'local',
          kind: 'local',
          label: 'Local Mac',
          detail: 'This computer',
          health: 'local'
        },
        {
          id: 'runtime:env-2',
          kind: 'runtime',
          label: 'env-2',
          detail: 'Orca server',
          health: 'available'
        }
      ],
      workspaceHostScope: 'all',
      visibleWorkspaceHostIds: ['runtime:env-2', 'local'],
      defaultHostId: 'local'
    })

    expect(sectioned.map((row) => (row.type === 'item' ? row.rowKey : row.key))).toEqual([
      'host:local',
      'folder-workspace:@owner:local:local-folder',
      'host:runtime:env-2',
      'folder-workspace:@owner:runtime%3Aenv-2:folder-1'
    ])
    expect(
      sectioned.flatMap((row) => (row.type === 'host-header' ? [[row.hostId, row.count]] : []))
    ).toEqual([
      ['local', 1],
      ['runtime:env-2', 1]
    ])
  })

  it('counts folder-only collapsed group headers per host', () => {
    const rows: Row[] = [
      {
        type: 'header',
        key: 'project-group:same-group',
        label: 'Folders',
        count: 2,
        tone: 'default',
        hostWorktreeCounts: new Map([
          ['local', 1],
          ['runtime:env-2', 1]
        ]),
        hostWorktreeIds: new Map([
          ['local', []],
          ['runtime:env-2', []]
        ]),
        hostFolderWorkspaceIds: new Map([
          ['local', ['local-folder']],
          ['runtime:env-2', ['runtime-folder']]
        ])
      }
    ]
    const sectioned = addHostSectionRows({
      rows,
      hostOptions: [
        { id: 'local', kind: 'local', label: 'Local', detail: '', health: 'local' },
        {
          id: 'runtime:env-2',
          kind: 'runtime',
          label: 'env-2',
          detail: '',
          health: 'available'
        }
      ],
      workspaceHostScope: 'all',
      visibleWorkspaceHostIds: ['local', 'runtime:env-2'],
      defaultHostId: 'local'
    })

    expect(
      sectioned.flatMap((row) => (row.type === 'host-header' ? [[row.hostId, row.count]] : []))
    ).toEqual([
      ['local', 1],
      ['runtime:env-2', 1]
    ])
  })

  it('aggregates roughly 130000 populated child entries without argument spread overflow', () => {
    const root = group({ id: 'root', executionHostId: 'local' })
    const child = group({
      id: 'child',
      parentGroupId: root.id,
      executionHostId: 'local'
    })
    const repo: Repo = {
      id: 'large-repo',
      path: '/large-repo',
      displayName: 'large-repo',
      badgeColor: '#000',
      addedAt: 1,
      projectGroupId: child.id,
      projectGroupOrder: 0,
      executionHostId: 'local'
    }
    const worktrees: Worktree[] = Array.from({ length: 130_000 }, (_, index) => ({
      id: `wt-${index}`,
      repoId: repo.id,
      path: `/large-repo/wt-${index}`,
      head: 'abc',
      branch: `refs/heads/wt-${index}`,
      isBare: false,
      isMainWorktree: false,
      displayName: `wt-${index}`,
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      linkedLinearIssue: null,
      linkedGitLabMR: null,
      linkedGitLabIssue: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: index,
      lastActivityAt: 0
    }))

    const rows = buildRows(
      'repo',
      worktrees,
      new Map([[repo.id, repo]]),
      null,
      new Set(),
      undefined,
      undefined,
      'manual',
      undefined,
      undefined,
      false,
      undefined,
      [root, child],
      new Set(),
      new Map(),
      new Map(),
      [],
      undefined,
      [],
      undefined,
      'local'
    )

    const rootHeader = rows.find(
      (row): row is Extract<(typeof rows)[number], { type: 'header' }> =>
        row.type === 'header' && row.projectGroup?.id === root.id
    )
    expect(rootHeader?.worktreeIds).toHaveLength(130_000)
    expect(rootHeader?.hostWorktreeIds?.get('local')).toHaveLength(130_000)
  })

  it('retains a local-stamped group needed by a visible legacy SSH folder', () => {
    const localGroup = group({
      id: 'legacy-group',
      connectionId: undefined,
      executionHostId: 'local'
    })
    const legacyFolder = folderWorkspace({
      projectGroupId: localGroup.id,
      connectionId: 'builder'
    })

    expect(
      filterProjectGroupsForVisibleHosts([localGroup], new Set(['ssh:builder']), 'local', [
        legacyFolder
      ])
    ).toEqual([localGroup])
  })

  it('keeps groups when the caller cannot provide folder membership', () => {
    const localGroup = group({ executionHostId: 'local' })

    expect(
      filterProjectGroupsForVisibleHosts([localGroup], new Set(['ssh:builder']), 'local')
    ).toEqual([localGroup])
  })
})
