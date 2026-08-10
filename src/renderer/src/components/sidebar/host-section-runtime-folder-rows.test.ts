import { describe, expect, it } from 'vitest'
import type { FolderWorkspace, ProjectGroup } from '../../../../shared/types'
import type { Row } from './worktree-list-groups'
import { addHostSectionRows } from './host-section-rows'

describe('runtime folder host section rows', () => {
  it('keeps a runtime-stamped folder under its host after a filter rebuild', () => {
    const projectGroup = {
      id: 'group-1',
      name: 'Remote folder',
      executionHostId: 'runtime:env-2',
      parentPath: '/workspace',
      parentGroupId: null,
      createdFrom: 'manual',
      tabOrder: 0,
      isCollapsed: false,
      color: null,
      createdAt: 1,
      updatedAt: 1
    } satisfies ProjectGroup
    const folderWorkspace = {
      id: 'folder-1',
      projectGroupId: projectGroup.id,
      name: 'Runtime workspace',
      folderPath: '/workspace',
      executionHostId: 'runtime:env-2',
      linkedTask: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 1,
      createdAt: 1,
      updatedAt: 1
    } satisfies FolderWorkspace
    const localProjectGroup = {
      ...projectGroup,
      id: 'local-group',
      name: 'Local folder',
      executionHostId: 'local'
    } satisfies ProjectGroup
    const localFolderWorkspace = {
      ...folderWorkspace,
      id: 'local-folder',
      projectGroupId: localProjectGroup.id,
      name: 'Local workspace',
      executionHostId: 'local'
    } satisfies FolderWorkspace
    const rows: Row[] = [
      {
        type: 'folder-workspace',
        key: 'folder-workspace:local:local-folder',
        folderWorkspace: localFolderWorkspace,
        projectGroup: localProjectGroup,
        depth: 0,
        groupDepth: 0
      },
      {
        type: 'folder-workspace',
        key: 'folder-workspace:runtime%3Aenv-2:folder-1',
        folderWorkspace,
        projectGroup,
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
