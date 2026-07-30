import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getDesktopGitRepositorySnapshot,
  subscribeDesktopGitRepositorySnapshot
} from './desktop-git-repository-snapshot-client'

const repositorySnapshot = vi.fn()
const subscribeRepositorySnapshot = vi.fn()
const runtimeEnvironmentCall = vi.fn()

beforeEach(() => {
  repositorySnapshot.mockReset()
  subscribeRepositorySnapshot.mockReset()
  runtimeEnvironmentCall.mockReset()
  vi.stubGlobal('window', {
    api: {
      git: { repositorySnapshot, subscribeRepositorySnapshot },
      runtimeEnvironments: { call: runtimeEnvironmentCall }
    }
  })
})

describe('getDesktopGitRepositorySnapshot', () => {
  it('subscribes with exact desktop host, option, and push-target identity', async () => {
    const handle = { unsubscribe: vi.fn() }
    const callback = vi.fn()
    const pushTarget = {
      remoteName: 'fork',
      branchName: 'feature/checks',
      remoteCreated: false
    }
    subscribeRepositorySnapshot.mockResolvedValue(handle)

    await expect(
      subscribeDesktopGitRepositorySnapshot(
        {
          settings: { activeRuntimeEnvironmentId: null },
          worktreeId: 'wt-1',
          worktreePath: '/repo',
          connectionId: 'ssh-1'
        },
        { reuseLineStats: true, pushTarget },
        callback
      )
    ).resolves.toBe(handle)

    expect(subscribeRepositorySnapshot).toHaveBeenCalledWith(
      {
        worktreePath: '/repo',
        connectionId: 'ssh-1',
        reuseLineStats: true,
        pushTarget
      },
      callback
    )
  })

  it('reads the exact desktop host snapshot identity', async () => {
    repositorySnapshot.mockResolvedValue(null)
    const pushTarget = {
      remoteName: 'fork',
      branchName: 'feature/checks',
      remoteUrl: 'ssh://git.example/repo',
      remoteCreated: false
    }

    await expect(
      getDesktopGitRepositorySnapshot(
        {
          settings: { activeRuntimeEnvironmentId: null },
          worktreeId: 'wt-1',
          worktreePath: '/repo',
          connectionId: 'ssh-1'
        },
        {
          includeIgnored: true,
          bypassEffectiveUpstreamNegativeCache: true,
          reuseLineStats: true,
          pushTarget
        }
      )
    ).resolves.toBeNull()

    expect(repositorySnapshot).toHaveBeenCalledWith({
      worktreePath: '/repo',
      connectionId: 'ssh-1',
      includeIgnored: true,
      bypassEffectiveUpstreamNegativeCache: true,
      reuseLineStats: true,
      pushTarget
    })
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })

  it('uses the backing folder path for a local folder workspace', async () => {
    repositorySnapshot.mockResolvedValue(null)
    const workspaceId = '123e4567-e89b-12d3-a456-426614174000'

    await getDesktopGitRepositorySnapshot({
      settings: { activeRuntimeEnvironmentId: null },
      worktreeId: `folder-repo::/home/user::workspace:${workspaceId}`,
      worktreePath: `/home/user::workspace:${workspaceId}`
    })

    expect(repositorySnapshot).toHaveBeenCalledWith({
      worktreePath: '/home/user',
      connectionId: undefined
    })
  })

  it('leaves active runtime-environment transport to a later slice', async () => {
    await expect(
      getDesktopGitRepositorySnapshot(
        {
          settings: { activeRuntimeEnvironmentId: 'env-1' },
          worktreeId: 'wt-1',
          worktreePath: '/repo'
        },
        {
          includeIgnored: true,
          bypassEffectiveUpstreamNegativeCache: true,
          reuseLineStats: true
        }
      )
    ).resolves.toBeNull()

    expect(repositorySnapshot).not.toHaveBeenCalled()
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })

  it('does not subscribe through desktop transport for active runtime environments', async () => {
    await expect(
      subscribeDesktopGitRepositorySnapshot(
        {
          settings: { activeRuntimeEnvironmentId: 'env-1' },
          worktreeId: 'wt-1',
          worktreePath: '/repo'
        },
        {},
        vi.fn()
      )
    ).resolves.toBeNull()

    expect(subscribeRepositorySnapshot).not.toHaveBeenCalled()
  })
})
