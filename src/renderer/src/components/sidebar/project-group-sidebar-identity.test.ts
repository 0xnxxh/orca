import { describe, expect, it } from 'vitest'
import type { ProjectGroup } from '../../../../shared/types'
import {
  buildProjectGroupSidebarIndex,
  findProjectGroupForSidebarOwner,
  getProjectGroupSidebarIdentity,
  hasSingleProjectGroupMutationOwner
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
  it('resolves duplicate ids only with their catalog owner', () => {
    const local = group('same-id', 'local')
    const runtime = group('same-id', 'runtime:env-1')
    const index = buildProjectGroupSidebarIndex([local, runtime])

    expect(findProjectGroupForSidebarOwner(index, 'same-id')).toBeUndefined()
    expect(findProjectGroupForSidebarOwner(index, 'same-id', 'local')).toBe(local)
    expect(findProjectGroupForSidebarOwner(index, 'same-id', 'runtime:env-1')).toBe(runtime)
    expect(getProjectGroupSidebarIdentity(local)).not.toBe(getProjectGroupSidebarIdentity(runtime))
  })

  it('disables focused-host mutations for mixed-owner and mismatched lists', () => {
    const localA = group('a', 'local')
    const localB = group('b', 'local')
    const runtime = group('c', 'runtime:env-1')

    expect(hasSingleProjectGroupMutationOwner([localA, localB], 'local')).toBe(true)
    expect(hasSingleProjectGroupMutationOwner([localA, localB], 'runtime:env-1')).toBe(false)
    expect(hasSingleProjectGroupMutationOwner([localA, runtime], 'local')).toBe(false)
  })
})
