import { describe, expect, it } from 'vitest'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { getAgentDetectionTargetKeyForWorktree } from './useAgentDetectionTarget'

describe('getAgentDetectionTargetKeyForWorktree', () => {
  it('uses an explicit runtime owner without scanning ambiguous child SSH repos', () => {
    let projectGroupReads = 0
    const repos = Array.from({ length: 100 }, (_, index) => {
      const repo = {
        id: `repo-${index}`,
        connectionId: `ssh-${index}`,
        executionHostId: `ssh:ssh-${index}`,
        path: `/workspace/repo-${index}`
      }
      Object.defineProperty(repo, 'projectGroupId', {
        enumerable: true,
        get: () => {
          projectGroupReads += 1
          return 'runtime-group'
        }
      })
      return repo
    })
    const state = {
      settings: { activeRuntimeEnvironmentId: 'focused-env' },
      folderWorkspaces: [
        {
          id: 'runtime-folder',
          projectGroupId: 'runtime-group',
          folderPath: '/workspace'
        }
      ],
      projectGroups: [
        {
          id: 'runtime-group',
          connectionId: null,
          executionHostId: 'runtime:owner-env'
        }
      ],
      repos,
      worktreesByRepo: {}
    } as Parameters<typeof getAgentDetectionTargetKeyForWorktree>[0]

    expect(getAgentDetectionTargetKeyForWorktree(state, folderWorkspaceKey('runtime-folder'))).toBe(
      'runtime:owner-env'
    )
    expect(projectGroupReads).toBe(0)
  })

  it('stays unresolved when ownership records have not hydrated', () => {
    const state = {
      settings: { activeRuntimeEnvironmentId: 'focused-env' },
      folderWorkspaces: [],
      projectGroups: [],
      repos: [],
      worktreesByRepo: {}
    } as Parameters<typeof getAgentDetectionTargetKeyForWorktree>[0]

    expect(getAgentDetectionTargetKeyForWorktree(state, 'missing-worktree')).toBeUndefined()
  })
})
