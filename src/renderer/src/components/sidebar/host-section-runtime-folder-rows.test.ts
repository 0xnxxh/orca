import { describe, expect, it } from 'vitest'
import type { FolderWorkspace, ProjectGroup } from '../../../../shared/types'
import { addHostSectionRows, type HostSectionRow } from './host-section-rows'
import type { Row } from './worktree-list-groups'

function rowKey(row: HostSectionRow): string {
  return row.type === 'item' ? row.rowKey : row.key
}

describe('runtime folder host section rows', () => {
  it('groups a runtime folder row under its stamped owner', () => {
    const projectGroup: ProjectGroup = {
      id: 'group-1',
      name: 'Runtime folder',
      parentPath: '/srv/project',
      connectionId: null,
      executionHostId: 'runtime:env-1',
      parentGroupId: null,
      createdFrom: 'manual',
      tabOrder: 0,
      isCollapsed: false,
      color: null,
      createdAt: 1,
      updatedAt: 1
    }
    const folderWorkspace: FolderWorkspace = {
      id: 'folder-1',
      projectGroupId: projectGroup.id,
      name: 'Folder workspace',
      folderPath: '/srv/project',
      connectionId: null,
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
    const localProjectGroup: ProjectGroup = {
      ...projectGroup,
      id: 'local-group',
      name: 'Local folder',
      executionHostId: 'local'
    }
    const localFolderWorkspace: FolderWorkspace = {
      ...folderWorkspace,
      id: 'local-folder',
      projectGroupId: localProjectGroup.id,
      name: 'Local workspace',
      executionHostId: 'local'
    }
    const rows: Row[] = [
      {
        type: 'header',
        key: 'project-group:local',
        label: 'Local folder',
        count: 1,
        tone: 'text-foreground',
        hostWorktreeCounts: new Map([['local', 1]]),
        folderWorkspaceIds: [localFolderWorkspace.id]
      },
      {
        type: 'folder-workspace',
        key: 'folder-workspace:local-folder',
        folderWorkspace: localFolderWorkspace,
        projectGroup: localProjectGroup,
        depth: 0,
        groupDepth: 1
      },
      {
        type: 'header',
        key: 'project-group:runtime',
        label: 'Runtime folder',
        count: 1,
        tone: 'text-foreground',
        hostWorktreeCounts: new Map([['runtime:env-1', 1]]),
        folderWorkspaceIds: [folderWorkspace.id]
      },
      {
        type: 'folder-workspace',
        key: 'folder-workspace:folder-1',
        folderWorkspace,
        projectGroup,
        depth: 0,
        groupDepth: 1
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
          id: 'runtime:env-1',
          kind: 'runtime',
          label: 'Runtime',
          detail: 'Orca server',
          health: 'available'
        }
      ],
      workspaceHostScope: 'all',
      defaultHostId: 'local'
    })

    expect(sectioned.map(rowKey)).toEqual([
      'host:local',
      'project-group:local',
      'folder-workspace:local-folder',
      'host:runtime:env-1',
      'project-group:runtime',
      'folder-workspace:folder-1'
    ])
  })
})
