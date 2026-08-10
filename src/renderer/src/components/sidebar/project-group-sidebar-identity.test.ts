import { describe, expect, it } from 'vitest'
import { getFolderWorkspaceRowKey } from '../../../../shared/folder-workspaces'
import type { FolderWorkspace, ProjectGroup } from '../../../../shared/types'
import {
  buildProjectGroupSidebarIndex,
  findProjectGroupForSidebarOwner,
  getAmbiguousFolderWorkspaceSidebarIds,
  getProjectGroupMutationSelector,
  getProjectGroupSidebarIdentity,
  getSingleProjectGroupMutationOwner,
  hasSingleProjectGroupMutationOwner,
  parseProjectGroupSidebarHeaderKey
} from './project-group-sidebar-identity'

function group(id: string, executionHostId: string): ProjectGroup {
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
    const local = group('same-id', 'local')
    const runtime = group('same-id', 'runtime:env-1')
    const index = buildProjectGroupSidebarIndex([local, runtime])

    expect(findProjectGroupForSidebarOwner(index, 'same-id')).toBeUndefined()
    expect(findProjectGroupForSidebarOwner(index, 'same-id', 'local')).toBe(local)
    expect(findProjectGroupForSidebarOwner(index, 'same-id', 'runtime:env-1')).toBe(runtime)
    expect(getProjectGroupSidebarIdentity(local)).not.toBe(getProjectGroupSidebarIdentity(runtime))
  })

  it('carries the exact owner from a rendered header into mutations', () => {
    const runtime = group('same-id', 'runtime:env-1')

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
    const local = group('local-group', 'local')
    const runtime = group('runtime-group', 'runtime:env-1')
    const index = buildProjectGroupSidebarIndex([local, runtime])

    expect(
      getAmbiguousFolderWorkspaceSidebarIds(index, [
        { id: 'same-id', projectGroupId: local.id, executionHostId: 'local' },
        { id: 'same-id', projectGroupId: runtime.id, executionHostId: 'runtime:env-1' },
        { id: 'unique-id', projectGroupId: runtime.id, executionHostId: 'runtime:env-1' }
      ])
    ).toEqual(new Set(['same-id']))
  })

  it('does not fall back to a foreign group for an explicit stale owner', () => {
    const local = group('same-id', 'local')
    const index = buildProjectGroupSidebarIndex([local])

    expect(findProjectGroupForSidebarOwner(index, 'same-id', 'runtime:missing')).toBeUndefined()
  })

  it('disables focused-host mutations for mixed-owner and mismatched lists', () => {
    const localA = group('a', 'local')
    const localB = group('b', 'local')
    const runtime = group('c', 'runtime:env-1')

    expect(hasSingleProjectGroupMutationOwner([localA, localB], 'local')).toBe(true)
    expect(hasSingleProjectGroupMutationOwner([localA, localB], 'runtime:env-1')).toBe(false)
    expect(hasSingleProjectGroupMutationOwner([localA, runtime], 'local')).toBe(false)
  })

  it('allows header reorder after filtering duplicate ids to one owner', () => {
    const local = group('same-id', 'local')
    const runtime = group('same-id', 'runtime:env-1')

    expect(getSingleProjectGroupMutationOwner([local, runtime])).toBeNull()
    expect(getSingleProjectGroupMutationOwner([runtime])).toBe('runtime:env-1')
  })
})
