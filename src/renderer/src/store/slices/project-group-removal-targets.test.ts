import { describe, expect, it } from 'vitest'
import type { FolderWorkspace, ProjectGroup, Repo } from '../../../../shared/types'
import { selectProjectGroupRemovalTargets } from './project-group-removal-targets'

const rootGroup: ProjectGroup = {
  id: 'root',
  name: 'Root',
  parentPath: null,
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}

const childGroup: ProjectGroup = {
  ...rootGroup,
  id: 'child',
  name: 'Child',
  parentGroupId: rootGroup.id,
  tabOrder: 1
}

const siblingGroup: ProjectGroup = {
  ...rootGroup,
  id: 'sibling',
  name: 'Sibling',
  tabOrder: 2
}

function makeRepo(id: string, projectGroupId: string | null): Repo {
  return {
    id,
    path: `/${id}`,
    displayName: id,
    badgeColor: '#000',
    addedAt: 1,
    projectGroupId
  }
}

function withOwner(group: ProjectGroup, executionHostId: string): ProjectGroup {
  return { ...group, executionHostId }
}

function makeFolderWorkspace(
  id: string,
  projectGroupId: string,
  executionHostId: 'local' | `runtime:${string}`
): FolderWorkspace {
  return {
    id,
    projectGroupId,
    executionHostId,
    name: id,
    folderPath: `/${id}`,
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
}

describe('selectProjectGroupRemovalTargets', () => {
  it('selects direct and nested child projects in repo order', () => {
    const result = selectProjectGroupRemovalTargets(
      [rootGroup, childGroup, siblingGroup],
      [
        makeRepo('direct', rootGroup.id),
        makeRepo('nested', childGroup.id),
        makeRepo('sibling', siblingGroup.id),
        makeRepo('ungrouped', null)
      ],
      rootGroup.id
    )

    expect(result.groupExists).toBe(true)
    expect([...result.deletedGroupIds].sort()).toEqual([childGroup.id, rootGroup.id])
    expect(result.projectIds).toEqual(['direct', 'nested'])
  })

  it('returns an empty project list for empty groups', () => {
    const result = selectProjectGroupRemovalTargets([rootGroup], [], rootGroup.id)

    expect(result.groupExists).toBe(true)
    expect([...result.deletedGroupIds]).toEqual([rootGroup.id])
    expect(result.projectIds).toEqual([])
  })

  it('does not synthesize targets for a missing group', () => {
    const result = selectProjectGroupRemovalTargets(
      [rootGroup],
      [makeRepo('direct', rootGroup.id)],
      'missing'
    )

    expect(result.groupExists).toBe(false)
    expect([...result.deletedGroupIds]).toEqual([])
    expect(result.projectIds).toEqual([])
  })

  it('requires an owner when group ids are ambiguous', () => {
    const result = selectProjectGroupRemovalTargets(
      [withOwner(rootGroup, 'local'), withOwner(rootGroup, 'runtime:env-1')],
      [],
      rootGroup.id
    )

    expect(result.groupExists).toBe(false)
    expect(result.ownerHostId).toBeNull()
  })

  it('does not fall back to a foreign owner when the requested owner is stale', () => {
    const result = selectProjectGroupRemovalTargets(
      [withOwner(rootGroup, 'local')],
      [],
      rootGroup.id,
      'runtime:env-1'
    )

    expect(result.groupExists).toBe(false)
    expect(result.ownerHostId).toBeNull()
  })

  it('scopes descendants, repos, and folders to the selected owner', () => {
    const localRoot = withOwner(rootGroup, 'local')
    const localChild = withOwner(childGroup, 'local')
    const runtimeRoot = withOwner(rootGroup, 'runtime:env-1')
    const runtimeChild = withOwner(childGroup, 'runtime:env-1')
    const localRepo: Repo = {
      ...makeRepo('same-repo', rootGroup.id),
      executionHostId: 'local'
    }
    const runtimeRepo: Repo = {
      ...makeRepo('same-repo', childGroup.id),
      executionHostId: 'runtime:env-1'
    }
    const localFolder = makeFolderWorkspace('same-folder', childGroup.id, 'local')
    const runtimeFolder = makeFolderWorkspace('same-folder', childGroup.id, 'runtime:env-1')

    const result = selectProjectGroupRemovalTargets(
      [localRoot, localChild, runtimeRoot, runtimeChild],
      [localRepo, runtimeRepo],
      rootGroup.id,
      'runtime:env-1',
      [localFolder, runtimeFolder]
    )

    expect(result.ownerHostId).toBe('runtime:env-1')
    expect(result.deletedGroupIdentities).toEqual(
      new Set(['["runtime:env-1","root"]', '["runtime:env-1","child"]'])
    )
    expect(result.projectTargets).toEqual([
      {
        projectId: 'same-repo',
        ownerHostId: 'runtime:env-1',
        identity: 'runtime:env-1\0same-repo'
      }
    ])
    expect(result.folderWorkspaceIdentities).toEqual(new Set(['["runtime:env-1","same-folder"]']))
  })

  it('removes a legacy SSH folder associated with one unstamped group', () => {
    const legacyGroup = { ...rootGroup, connectionId: undefined }
    const legacyFolder = {
      ...makeFolderWorkspace('legacy-folder', legacyGroup.id, 'local'),
      executionHostId: undefined,
      connectionId: 'builder'
    }

    const result = selectProjectGroupRemovalTargets([legacyGroup], [], legacyGroup.id, 'local', [
      legacyFolder
    ])

    expect(result.folderWorkspaceIdentities).toEqual(new Set(['["local","legacy-folder"]']))
  })
})
