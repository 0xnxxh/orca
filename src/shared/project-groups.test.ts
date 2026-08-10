import { describe, expect, it } from 'vitest'
import {
  buildProjectGroupOwnerIndex,
  clearMissingProjectGroupMemberships,
  createProjectGroup,
  getEffectiveProjectGroupManualRank,
  getFolderWorkspaceProjectGroupOwnerHostId,
  getNextProjectGroupOrder,
  getProjectGroupOwnerIdentity,
  getProjectGroupOwnerSubtreeIdentities,
  getProjectGroupSubtreeIds,
  normalizeProjectGroupName,
  normalizeProjectGroups,
  resolveFolderWorkspaceProjectGroup,
  resolveProjectGroupOwner
} from './project-groups'
import { normalizeFolderWorkspaces } from './folder-workspaces'
import type { ProjectGroup, Repo } from './types'

function repo(overrides: Partial<Repo>): Repo {
  return {
    id: overrides.id ?? 'repo-1',
    path: overrides.path ?? '/repo',
    displayName: overrides.displayName ?? 'repo',
    badgeColor: '#999',
    addedAt: 1,
    kind: 'git',
    ...overrides
  }
}

function projectGroup(overrides: Partial<ProjectGroup>): ProjectGroup {
  return {
    id: overrides.id ?? 'group-1',
    name: overrides.name ?? 'Group',
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('project-groups', () => {
  it('creates a durable project group with normalized defaults', () => {
    const group = createProjectGroup({
      name: '  Platform  ',
      parentPath: '/srv/platform',
      createdFrom: 'folder-scan',
      tabOrder: 3,
      now: 100
    })

    expect(group).toMatchObject({
      name: 'Platform',
      parentPath: '/srv/platform',
      parentGroupId: null,
      createdFrom: 'folder-scan',
      tabOrder: 3,
      isCollapsed: false,
      color: null,
      createdAt: 100,
      updatedAt: 100
    })
  })

  it('trims empty group names to a fallback', () => {
    expect(normalizeProjectGroupName('   ', 'Existing')).toBe('Existing')
  })

  it('normalizes persisted groups and drops malformed entries', () => {
    const groups = normalizeProjectGroups([
      { id: 'b', name: 'B', tabOrder: 2 },
      {
        id: 'a',
        name: 'A',
        tabOrder: 1,
        parentGroupId: 'missing',
        createdFrom: 'folder-scan',
        isCollapsed: true
      },
      { id: 'a', name: 'duplicate' },
      { name: 'missing id' }
    ])

    expect(groups.map((group) => group.id)).toEqual(['a', 'b'])
    expect(groups[0]).toMatchObject({
      createdFrom: 'folder-scan',
      isCollapsed: true,
      parentGroupId: null
    })
  })

  it('preserves normalized execution ownership for persisted groups', () => {
    const groups = normalizeProjectGroups([
      { id: 'runtime', name: 'Runtime', tabOrder: 1, executionHostId: 'runtime:env-1' },
      { id: 'local', name: 'Local', tabOrder: 2, executionHostId: 'local' },
      { id: 'invalid', name: 'Invalid', tabOrder: 3, executionHostId: 'runtime:' }
    ])

    expect(groups.find((group) => group.id === 'runtime')?.executionHostId).toBe('runtime:env-1')
    expect(groups.find((group) => group.id === 'local')?.executionHostId).toBe('local')
    expect(groups.find((group) => group.id === 'invalid')?.executionHostId).toBeUndefined()
  })

  it('preserves same-id groups and parentage independently across owners', () => {
    const groups = normalizeProjectGroups([
      projectGroup({ id: 'root', name: 'Local root' }),
      projectGroup({ id: 'child', name: 'Local child', parentGroupId: 'root' }),
      projectGroup({ id: 'root', name: 'SSH root', connectionId: 'builder' }),
      projectGroup({
        id: 'child',
        name: 'SSH child',
        connectionId: 'builder',
        parentGroupId: 'root'
      }),
      projectGroup({ id: 'root', name: 'Duplicate SSH root', connectionId: 'builder' })
    ])

    expect(groups.map((group) => [group.name, group.parentGroupId])).toEqual([
      ['Local child', 'root'],
      ['Local root', null],
      ['SSH child', 'root'],
      ['SSH root', null]
    ])
  })

  it('resolves mutations exactly by owner and rejects ambiguous legacy selectors', () => {
    const local = projectGroup({ id: 'same-id', name: 'Local' })
    const ssh = projectGroup({ id: 'same-id', name: 'SSH', connectionId: 'builder' })
    const index = buildProjectGroupOwnerIndex([local, ssh])

    expect(resolveProjectGroupOwner(index, 'same-id', 'local')).toBe(local)
    expect(resolveProjectGroupOwner(index, 'same-id', 'ssh:builder')).toBe(ssh)
    expect(resolveProjectGroupOwner(index, 'same-id')).toBeNull()
    expect(resolveProjectGroupOwner(index, 'same-id', 'ssh:missing')).toBeNull()
  })

  it('resolves folder membership by owner and rejects unstamped same-id ambiguity', () => {
    const local = projectGroup({ id: 'same-id', name: 'Local' })
    const runtime = projectGroup({
      id: 'same-id',
      name: 'Runtime',
      executionHostId: 'runtime:env-1'
    })
    const index = buildProjectGroupOwnerIndex([local, runtime])

    expect(
      resolveFolderWorkspaceProjectGroup(index, {
        projectGroupId: 'same-id',
        connectionId: null
      })
    ).toBe(local)
    expect(
      resolveFolderWorkspaceProjectGroup(index, {
        projectGroupId: 'same-id',
        executionHostId: 'runtime:env-1'
      })
    ).toBe(runtime)
    expect(resolveFolderWorkspaceProjectGroup(index, { projectGroupId: 'same-id' })).toBeNull()
  })

  it('retains a legacy SSH folder owner with one unstamped group', () => {
    const legacyGroup = normalizeProjectGroups([
      {
        id: 'legacy',
        name: 'Legacy',
        parentPath: '/legacy',
        createdFrom: 'migration',
        tabOrder: 0
      }
    ])[0]!
    expect(legacyGroup.connectionId).toBeUndefined()
    const index = buildProjectGroupOwnerIndex([legacyGroup])
    const workspace = { projectGroupId: 'legacy', connectionId: 'builder' }

    expect(resolveFolderWorkspaceProjectGroup(index, workspace)).toBeNull()
    expect(getFolderWorkspaceProjectGroupOwnerHostId(workspace, index)).toBe('ssh:builder')
    expect(
      normalizeFolderWorkspaces(
        [{ id: 'legacy-folder', projectGroupId: 'legacy', connectionId: 'builder' }],
        [legacyGroup]
      )
    ).toHaveLength(1)
  })

  it('rejects folder workspaces stamped for missing foreign owners', () => {
    const local = projectGroup({
      id: 'same-id',
      name: 'Local',
      parentPath: '/local',
      connectionId: null
    })

    expect(
      normalizeFolderWorkspaces(
        [
          {
            id: 'runtime-folder',
            projectGroupId: 'same-id',
            executionHostId: 'runtime:missing'
          },
          {
            id: 'ssh-folder',
            projectGroupId: 'same-id',
            connectionId: 'missing'
          }
        ],
        [local]
      )
    ).toEqual([])
  })

  it('collects descendants only from the selected owner hierarchy', () => {
    const localRoot = projectGroup({ id: 'root', name: 'Local root' })
    const localChild = projectGroup({ id: 'child', parentGroupId: 'root' })
    const sshRoot = projectGroup({ id: 'root', name: 'SSH root', connectionId: 'builder' })
    const sshChild = projectGroup({
      id: 'child',
      parentGroupId: 'root',
      connectionId: 'builder'
    })

    expect(
      getProjectGroupOwnerSubtreeIdentities([localRoot, localChild, sshRoot, sshChild], localRoot)
    ).toEqual(
      new Set([getProjectGroupOwnerIdentity(localRoot), getProjectGroupOwnerIdentity(localChild)])
    )
  })

  it('clears repo memberships whose group no longer exists', () => {
    const groups = [createProjectGroup({ name: 'Known', createdFrom: 'manual', tabOrder: 0 })]
    const repos = clearMissingProjectGroupMemberships(
      [
        repo({ id: 'known', projectGroupId: groups[0].id }),
        repo({ id: 'missing', projectGroupId: 'x' })
      ],
      groups
    )

    expect(repos.find((entry) => entry.id === 'known')?.projectGroupId).toBe(groups[0].id)
    expect(repos.find((entry) => entry.id === 'missing')?.projectGroupId).toBeNull()
  })

  it('does not retain repo membership from another owner with the same group id', () => {
    const localGroup = projectGroup({ id: 'same-id', name: 'Local' })
    const sshGroup = projectGroup({ id: 'same-id', name: 'SSH', connectionId: 'builder' })
    const repos = clearMissingProjectGroupMemberships(
      [
        repo({ id: 'local', projectGroupId: 'same-id' }),
        repo({ id: 'ssh', projectGroupId: 'same-id', connectionId: 'builder' }),
        repo({ id: 'wrong-local', projectGroupId: 'ssh-only' })
      ],
      [localGroup, sshGroup, projectGroup({ id: 'ssh-only', connectionId: 'builder' })]
    )

    expect(repos.map((entry) => [entry.id, entry.projectGroupId])).toEqual([
      ['local', 'same-id'],
      ['ssh', 'same-id'],
      ['wrong-local', null]
    ])
  })

  it('falls back to global repo order when projectGroupOrder is unset', () => {
    const repoOrder = new Map([
      ['a', 0],
      ['b', 2]
    ])

    expect(
      getEffectiveProjectGroupManualRank(repo({ id: 'a', projectGroupOrder: 5 }), repoOrder)
    ).toBe(5)
    expect(getEffectiveProjectGroupManualRank(repo({ id: 'a' }), repoOrder)).toBe(0)
    expect(getEffectiveProjectGroupManualRank(repo({ id: 'b' }), repoOrder)).toBe(2000)
    expect(getEffectiveProjectGroupManualRank(repo({ id: 'c' }), repoOrder, 1)).toBe(1000)
  })

  it('computes the next order inside a group independently from ungrouped repos', () => {
    expect(
      getNextProjectGroupOrder(
        [
          repo({ id: 'a', projectGroupId: 'g', projectGroupOrder: 2 }),
          repo({ id: 'b', projectGroupId: null, projectGroupOrder: 9 })
        ],
        'g'
      )
    ).toBe(3)
  })

  it('collects descendant group ids for subtree deletion', () => {
    expect(
      [
        ...getProjectGroupSubtreeIds(
          [
            { id: 'root', parentGroupId: null },
            { id: 'child', parentGroupId: 'root' },
            { id: 'grandchild', parentGroupId: 'child' },
            { id: 'sibling', parentGroupId: null }
          ],
          'root'
        )
      ].sort()
    ).toEqual(['child', 'grandchild', 'root'])
  })

  it('collects wide descendant groups without overflowing argument limits', () => {
    const groups = [
      { id: 'root', parentGroupId: null },
      ...Array.from({ length: 130_000 }, (_, index) => ({
        id: `child-${index}`,
        parentGroupId: 'root'
      }))
    ]

    const subtreeIds = getProjectGroupSubtreeIds(groups, 'root')

    expect(subtreeIds.size).toBe(130_001)
    expect(subtreeIds.has('root')).toBe(true)
    expect(subtreeIds.has('child-129999')).toBe(true)
  })
})
