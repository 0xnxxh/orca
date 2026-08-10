import { describe, expect, it } from 'vitest'
import type { ProjectGroup, Repo } from '../../../../shared/types'
import {
  getFolderSourceRepos,
  getFolderWorkspacePrimaryActionLabel
} from './folder-workspace-composer-helpers'

function repo(id: string, overrides: Partial<Repo> = {}): Repo {
  return {
    id,
    path: '/srv/app',
    displayName: id,
    badgeColor: '#111111',
    addedAt: 1,
    kind: 'git',
    ...overrides
  }
}

function group(overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    id: 'group-ssh-a',
    name: 'Remote App',
    parentPath: '/srv',
    connectionId: 'ssh-a',
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

describe('getFolderSourceRepos', () => {
  it('only returns source repos from the same execution host as the folder group', () => {
    const projectGroup = group()
    const localSamePath = repo('local-same-path', { connectionId: null })
    const otherSshSamePath = repo('ssh-b-same-path', { connectionId: 'ssh-b' })
    const matchingSshByPath = repo('ssh-a-by-path', { connectionId: 'ssh-a' })
    const matchingSshByGroup = repo('ssh-a-by-group', {
      path: '/other/path',
      connectionId: 'ssh-a',
      projectGroupId: projectGroup.id
    })

    expect(
      getFolderSourceRepos(
        [localSamePath, otherSshSamePath, matchingSshByPath, matchingSshByGroup],
        [projectGroup],
        projectGroup
      ).map((item) => item.id)
    ).toEqual(['ssh-a-by-path', 'ssh-a-by-group'])
  })

  it('returns runtime source repos for runtime-owned folder groups', () => {
    const projectGroup = group({ connectionId: null, executionHostId: 'runtime:env-1' })
    const localSamePath = repo('local-same-path', { connectionId: null, executionHostId: 'local' })
    const runtimeByPath = repo('runtime-by-path', {
      connectionId: null,
      executionHostId: 'runtime:env-1'
    })
    const runtimeByGroup = repo('runtime-by-group', {
      path: '/other/path',
      connectionId: null,
      executionHostId: 'runtime:env-1',
      projectGroupId: projectGroup.id
    })

    expect(
      getFolderSourceRepos(
        [localSamePath, runtimeByPath, runtimeByGroup],
        [projectGroup],
        projectGroup
      ).map((item) => item.id)
    ).toEqual(['runtime-by-path', 'runtime-by-group'])
  })

  it('ignores descendant ids contributed only by another owner', () => {
    const localRoot = group({
      id: 'root',
      name: 'Local root',
      parentPath: '/local',
      connectionId: null,
      executionHostId: 'local'
    })
    const localUnrelated = group({
      id: 'foreign-child',
      name: 'Local unrelated',
      parentPath: '/other',
      connectionId: null,
      executionHostId: 'local'
    })
    const runtimeRoot = group({
      id: 'root',
      name: 'Runtime root',
      parentPath: '/runtime',
      connectionId: null,
      executionHostId: 'runtime:env-1'
    })
    const runtimeChild = group({
      id: 'foreign-child',
      name: 'Runtime child',
      parentPath: '/runtime/child',
      connectionId: null,
      executionHostId: 'runtime:env-1',
      parentGroupId: 'root'
    })
    const localRepo = repo('local-unrelated', {
      path: '/outside/root',
      connectionId: null,
      executionHostId: 'local',
      projectGroupId: 'foreign-child'
    })

    expect(
      getFolderSourceRepos(
        [localRepo],
        [localRoot, localUnrelated, runtimeRoot, runtimeChild],
        localRoot
      )
    ).toEqual([])
  })
})

describe('getFolderWorkspacePrimaryActionLabel', () => {
  it('uses a stable workspace creation label independent of quick agent selection', () => {
    const label = (getFolderWorkspacePrimaryActionLabel as (...args: unknown[]) => string)({
      id: 'codex'
    })

    expect(label).toBe('Create workspace')
    expect(label).not.toContain('Agent')
  })
})
