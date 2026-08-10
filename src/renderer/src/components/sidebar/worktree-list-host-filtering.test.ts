import { describe, expect, it } from 'vitest'
import type { FolderWorkspace, ProjectGroup } from '../../../../shared/types'
import { addHostSectionRows } from './host-section-rows'
import type { Row } from './worktree-list-groups'
import {
  getFolderPathStatusRouteOptionsForRows,
  getFolderWorkspaceExecutionHostIdForRows,
  getProjectGroupExecutionHostIdForRows,
  getRuntimeEnvironmentIdForFolderPathStatusHost
} from './worktree-list-host-filtering'

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

  it('extracts runtime route ids for folder path status requests', () => {
    expect(getRuntimeEnvironmentIdForFolderPathStatusHost('runtime:env-1')).toBe('env-1')
    expect(getRuntimeEnvironmentIdForFolderPathStatusHost('ssh:ssh-builder')).toBeNull()
    expect(getRuntimeEnvironmentIdForFolderPathStatusHost('local')).toBeNull()
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
        key: 'folder-workspace:local:local-folder',
        folderWorkspace: localFolder,
        projectGroup: localGroup,
        depth: 0,
        groupDepth: 0
      },
      {
        type: 'folder-workspace',
        key: 'folder-workspace:runtime%3Aenv-2:folder-1',
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
      'folder-workspace:local:local-folder',
      'host:runtime:env-2',
      'folder-workspace:runtime%3Aenv-2:folder-1'
    ])
  })
})
