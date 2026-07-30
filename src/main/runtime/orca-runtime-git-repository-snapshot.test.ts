import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/types'
import type * as GitStatusModule from '../git/status'
import type * as GitUpstreamModule from '../git/upstream'
import { RuntimeGitCommands, type ResolvedRuntimeGitWorktree } from './orca-runtime-git'

const mocks = vi.hoisted(() => ({
  getGitRepositorySnapshot: vi.fn(),
  getSshGitProvider: vi.fn(),
  getStatus: vi.fn(),
  getUpstreamStatus: vi.fn()
}))

vi.mock('../git/status', async () => ({
  ...(await vi.importActual<typeof GitStatusModule>('../git/status')),
  getGitRepositorySnapshot: mocks.getGitRepositorySnapshot,
  getStatus: mocks.getStatus
}))

vi.mock('../git/upstream', async () => ({
  ...(await vi.importActual<typeof GitUpstreamModule>('../git/upstream')),
  getUpstreamStatus: mocks.getUpstreamStatus
}))

vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: mocks.getSshGitProvider
}))

function makeWorktree(path: string): ResolvedRuntimeGitWorktree {
  return {
    id: 'wt-1',
    repoId: 'repo-1',
    path,
    linkedIssue: null,
    git: {
      path,
      branch: 'main',
      isBare: false,
      isMainWorktree: false,
      head: 'a'.repeat(40)
    }
  } as unknown as ResolvedRuntimeGitWorktree
}

describe('RuntimeGitCommands repository snapshot query', () => {
  beforeEach(() => {
    mocks.getGitRepositorySnapshot.mockReset()
    mocks.getSshGitProvider.mockReset()
    mocks.getStatus.mockReset()
    mocks.getUpstreamStatus.mockReset()
  })

  it('reads the exact native or WSL owner identity and push target', async () => {
    const pushTarget = {
      remoteName: 'fork',
      branchName: 'feature/checks',
      remoteUrl: 'ssh://git.example/repo',
      remoteCreated: false
    }
    mocks.getGitRepositorySnapshot.mockReturnValue(null)
    const commands = new RuntimeGitCommands({
      resolveRuntimeGitTarget: async (selector) => {
        expect(selector).toBe('id:wt-1')
        return {
          worktree: makeWorktree('/workspace/feature'),
          repo: { path: '/workspace/repo', symlinkPaths: ['node_modules'] } as never,
          localGitOptions: { wslDistro: 'Ubuntu-24.04' }
        }
      },
      getRuntimeSettings: () => ({}) as GlobalSettings
    })

    await commands.getRuntimeGitRepositorySnapshot(
      'id:wt-1',
      { includeIgnored: true, reuseLineStats: true },
      pushTarget
    )

    expect(mocks.getGitRepositorySnapshot).toHaveBeenCalledWith(
      '/workspace/feature',
      {
        includeIgnored: true,
        reuseLineStats: true,
        wslDistro: 'Ubuntu-24.04',
        sharedLinkPaths: ['node_modules']
      },
      pushTarget
    )
    expect(mocks.getStatus).not.toHaveBeenCalled()
  })

  it('reads the current SSH provider incarnation without a remote status call', async () => {
    const pushTarget = {
      remoteName: 'origin',
      branchName: 'feature/checks',
      remoteCreated: false
    }
    const provider = {
      getRepositorySnapshot: vi.fn().mockReturnValue(null),
      getStatus: vi.fn()
    }
    mocks.getSshGitProvider.mockReturnValue(provider)
    const commands = new RuntimeGitCommands({
      resolveRuntimeGitTarget: async () => ({
        worktree: makeWorktree('/remote/repo'),
        connectionId: 'conn-2'
      }),
      getRuntimeSettings: () => ({}) as GlobalSettings
    })

    await commands.getRuntimeGitRepositorySnapshot(
      'id:wt-1',
      { bypassEffectiveUpstreamNegativeCache: true },
      pushTarget
    )

    expect(mocks.getSshGitProvider).toHaveBeenCalledWith('conn-2')
    expect(provider.getRepositorySnapshot).toHaveBeenCalledWith(
      '/remote/repo',
      { bypassEffectiveUpstreamNegativeCache: true },
      pushTarget
    )
    expect(provider.getStatus).not.toHaveBeenCalled()
    expect(mocks.getGitRepositorySnapshot).not.toHaveBeenCalled()
  })

  it('measures settled local or WSL polling plus Checks as two fresh loads versus one', async () => {
    const pushTarget = { remoteName: 'fork', branchName: 'feature/checks' }
    mocks.getStatus.mockResolvedValue({ entries: [], conflictOperation: 'none' })
    mocks.getUpstreamStatus.mockResolvedValue({ hasUpstream: true, ahead: 0, behind: 0 })
    mocks.getGitRepositorySnapshot.mockReturnValue({ revision: 2 })
    const commands = new RuntimeGitCommands({
      resolveRuntimeGitTarget: async () => ({
        worktree: makeWorktree('/workspace/feature'),
        localGitOptions: { wslDistro: 'Ubuntu-24.04' }
      }),
      getRuntimeSettings: () => ({}) as GlobalSettings
    })

    await commands.getRuntimeGitStatus('id:wt-1')
    await commands.getRuntimeGitUpstreamStatus('id:wt-1', pushTarget)
    await commands.getRuntimeGitStatus('id:wt-1')
    await commands.getRuntimeGitUpstreamStatus('id:wt-1', pushTarget)
    const baseline = {
      status: mocks.getStatus.mock.calls.length,
      upstream: mocks.getUpstreamStatus.mock.calls.length
    }

    mocks.getStatus.mockClear()
    mocks.getUpstreamStatus.mockClear()
    await commands.getRuntimeGitStatus('id:wt-1')
    await commands.getRuntimeGitUpstreamStatus('id:wt-1', pushTarget)
    await commands.getRuntimeGitRepositorySnapshot('id:wt-1', undefined, pushTarget)
    const migrated = {
      status: mocks.getStatus.mock.calls.length,
      upstream: mocks.getUpstreamStatus.mock.calls.length
    }

    expect({ baseline, migrated }).toEqual({
      baseline: { status: 2, upstream: 2 },
      migrated: { status: 1, upstream: 1 }
    })
  })

  it('measures settled SSH polling plus Checks as two remote calls versus one', async () => {
    const pushTarget = { remoteName: 'fork', branchName: 'feature/checks' }
    const provider = {
      getStatus: vi.fn().mockResolvedValue({ entries: [], conflictOperation: 'none' }),
      getUpstreamStatus: vi.fn().mockResolvedValue({ hasUpstream: true, ahead: 0, behind: 0 }),
      getRepositorySnapshot: vi.fn().mockReturnValue({ revision: 2 })
    }
    mocks.getSshGitProvider.mockReturnValue(provider)
    const commands = new RuntimeGitCommands({
      resolveRuntimeGitTarget: async () => ({
        worktree: makeWorktree('/remote/repo'),
        connectionId: 'conn-2'
      }),
      getRuntimeSettings: () => ({}) as GlobalSettings
    })

    await commands.getRuntimeGitStatus('id:wt-1')
    await commands.getRuntimeGitUpstreamStatus('id:wt-1', pushTarget)
    await commands.getRuntimeGitStatus('id:wt-1')
    await commands.getRuntimeGitUpstreamStatus('id:wt-1', pushTarget)
    const baseline = {
      status: provider.getStatus.mock.calls.length,
      upstream: provider.getUpstreamStatus.mock.calls.length
    }

    provider.getStatus.mockClear()
    provider.getUpstreamStatus.mockClear()
    await commands.getRuntimeGitStatus('id:wt-1')
    await commands.getRuntimeGitUpstreamStatus('id:wt-1', pushTarget)
    await commands.getRuntimeGitRepositorySnapshot('id:wt-1', undefined, pushTarget)
    const migrated = {
      status: provider.getStatus.mock.calls.length,
      upstream: provider.getUpstreamStatus.mock.calls.length
    }

    expect({ baseline, migrated }).toEqual({
      baseline: { status: 2, upstream: 2 },
      migrated: { status: 1, upstream: 1 }
    })
    expect(provider.getRepositorySnapshot).toHaveBeenCalledWith(
      '/remote/repo',
      undefined,
      pushTarget
    )
  })
})
