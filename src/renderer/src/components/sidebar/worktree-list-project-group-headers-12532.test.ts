import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { ProjectGroup, Repo, Worktree } from '../../../../shared/types'
import { buildRows } from './worktree-list-groups'
import { getRenderRowKey } from './worktree-list-virtual-rows'

function group(ownerHostId: ExecutionHostId): ProjectGroup {
  return {
    id: 'same-id',
    name: `${ownerHostId} group`,
    parentPath: null,
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

function repo(id: string, ownerHostId: ExecutionHostId): Repo {
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

function worktree(id: string, repoId: string): Worktree {
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
  ownerQualifiedProjectGroupIds = new Set(['same-id'])
) {
  const groups = owners.map(group)
  const repos = owners.map((owner, index) => repo(`repo-${index}`, owner))
  return buildRows(
    'repo',
    repos.map((project, index) => worktree(`wt-${index}`, project.id)),
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
    [],
    undefined,
    'local',
    undefined,
    ownerQualifiedProjectGroupIds
  )
}

function projectGroupHeaderKeys(rows: ReturnType<typeof buildOwnerRows>): string[] {
  return rows.flatMap((row) =>
    row.type === 'header' && row.projectGroup && !row.repo ? [row.key] : []
  )
}

describe('duplicate project-group header identity (#12532)', () => {
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
})
