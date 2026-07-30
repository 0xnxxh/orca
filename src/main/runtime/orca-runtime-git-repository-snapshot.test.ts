import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/types'
import type * as GitStatusModule from '../git/status'
import type * as GitUpstreamModule from '../git/upstream'
import { RuntimeGitCommands, type ResolvedRuntimeGitWorktree } from './orca-runtime-git'

const mocks = vi.hoisted(() => ({
  getGitRepositorySnapshot: vi.fn(),
  subscribeGitRepositorySnapshot: vi.fn(),
  getSshGitProvider: vi.fn(),
  getSshGitProviderGeneration: vi.fn(),
  subscribeSshGitProviderRegistry: vi.fn(),
  getStatus: vi.fn(),
  getUpstreamStatus: vi.fn()
}))

vi.mock('../git/status', async () => ({
  ...(await vi.importActual<typeof GitStatusModule>('../git/status')),
  getGitRepositorySnapshot: mocks.getGitRepositorySnapshot,
  subscribeGitRepositorySnapshot: mocks.subscribeGitRepositorySnapshot,
  getStatus: mocks.getStatus
}))

vi.mock('../git/upstream', async () => ({
  ...(await vi.importActual<typeof GitUpstreamModule>('../git/upstream')),
  getUpstreamStatus: mocks.getUpstreamStatus
}))

vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: mocks.getSshGitProvider,
  getSshGitProviderGeneration: mocks.getSshGitProviderGeneration,
  subscribeSshGitProviderRegistry: mocks.subscribeSshGitProviderRegistry
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
    mocks.subscribeGitRepositorySnapshot.mockReset()
    mocks.getSshGitProvider.mockReset()
    mocks.getSshGitProviderGeneration.mockReset()
    mocks.subscribeSshGitProviderRegistry.mockReset()
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

  it('subscribes to the exact native or WSL owner identity', async () => {
    const unsubscribe = vi.fn()
    let publish:
      | ((event: { state: 'ready'; generation: number; revision: number }) => void)
      | null = null
    mocks.subscribeGitRepositorySnapshot.mockImplementation(
      (_path, _options, _pushTarget, listener) => {
        publish = listener
        return unsubscribe
      }
    )
    const listener = vi.fn()
    const commands = new RuntimeGitCommands({
      resolveRuntimeGitTarget: async () => ({
        worktree: makeWorktree('/workspace/feature'),
        repo: { path: '/workspace/repo', symlinkPaths: ['node_modules'] } as never,
        localGitOptions: { wslDistro: 'Ubuntu-24.04' }
      }),
      getRuntimeSettings: () => ({}) as GlobalSettings
    })

    const subscription = await commands.subscribeRuntimeGitRepositorySnapshotRevision(
      'id:wt-1',
      { reuseLineStats: true },
      { remoteName: 'fork', branchName: 'feature/checks', remoteCreated: false },
      listener
    )
    const publishReady = publish as
      | ((event: { state: 'ready'; generation: number; revision: number }) => void)
      | null
    expect(publishReady).not.toBeNull()
    publishReady?.({
      state: 'ready',
      generation: 3,
      revision: 9
    })

    expect(mocks.subscribeGitRepositorySnapshot).toHaveBeenCalledWith(
      '/workspace/feature',
      {
        reuseLineStats: true,
        wslDistro: 'Ubuntu-24.04',
        sharedLinkPaths: ['node_modules']
      },
      { remoteName: 'fork', branchName: 'feature/checks', remoteCreated: false },
      expect.any(Function)
    )
    expect(listener).toHaveBeenCalledWith({
      state: 'ready',
      generation: 3,
      revision: 9,
      incarnation: 0
    })
    subscription.unsubscribe()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('keeps native revision subscriptions out of the WSL identity', async () => {
    mocks.subscribeGitRepositorySnapshot.mockReturnValue(vi.fn())
    const commands = new RuntimeGitCommands({
      resolveRuntimeGitTarget: async () => ({
        worktree: makeWorktree('/workspace/native')
      }),
      getRuntimeSettings: () => ({}) as GlobalSettings
    })

    await commands.subscribeRuntimeGitRepositorySnapshotRevision(
      'id:wt-1',
      undefined,
      undefined,
      vi.fn()
    )

    expect(mocks.subscribeGitRepositorySnapshot).toHaveBeenCalledWith(
      '/workspace/native',
      {},
      undefined,
      expect.any(Function)
    )
  })

  it('invalidates and rebinds the exact SSH provider incarnation', async () => {
    const ownerUnsubscribes = [vi.fn(), vi.fn()]
    const ownerListeners: ((event: {
      state: 'ready'
      generation: number
      revision: number
    }) => void)[] = []
    const providers = ownerUnsubscribes.map((unsubscribe) => ({
      subscribeRepositorySnapshot: vi.fn((_path, _options, _pushTarget, listener) => {
        ownerListeners.push(listener)
        return unsubscribe
      })
    }))
    let registryListener:
      | ((event: {
          connectionId: string
          generation: number
          provider: (typeof providers)[number] | undefined
        }) => void)
      | undefined
    const unsubscribeRegistry = vi.fn()
    mocks.subscribeSshGitProviderRegistry.mockImplementation((listener) => {
      registryListener = listener
      return unsubscribeRegistry
    })
    mocks.getSshGitProvider.mockReturnValue(providers[0])
    mocks.getSshGitProviderGeneration.mockReturnValue(4)
    const listener = vi.fn()
    const commands = new RuntimeGitCommands({
      resolveRuntimeGitTarget: async () => ({
        worktree: makeWorktree('/remote/repo'),
        connectionId: 'conn-2'
      }),
      getRuntimeSettings: () => ({}) as GlobalSettings
    })

    const subscription = await commands.subscribeRuntimeGitRepositorySnapshotRevision(
      'id:wt-1',
      undefined,
      undefined,
      listener
    )
    ownerListeners[0]?.({ state: 'ready', generation: 1, revision: 7 })
    registryListener?.({ connectionId: 'other', generation: 9, provider: undefined })
    registryListener?.({ connectionId: 'conn-2', generation: 5, provider: providers[1] })
    ownerListeners[0]?.({ state: 'ready', generation: 2, revision: 8 })
    ownerListeners[1]?.({ state: 'ready', generation: 0, revision: 1 })

    expect(listener.mock.calls).toEqual([
      [{ state: 'ready', generation: 1, revision: 7, incarnation: 4 }],
      [{ state: 'invalidated', generation: 0, revision: 0, incarnation: 5 }],
      [{ state: 'ready', generation: 0, revision: 1, incarnation: 5 }]
    ])
    expect(ownerUnsubscribes[0]).toHaveBeenCalledOnce()
    subscription.unsubscribe()
    expect(unsubscribeRegistry).toHaveBeenCalledOnce()
    expect(ownerUnsubscribes[1]).toHaveBeenCalledOnce()
  })

  it('measures settled local or WSL polling plus Checks as two fresh loads versus one', async () => {
    const pushTarget = { remoteName: 'fork', branchName: 'feature/checks' }
    mocks.getStatus.mockResolvedValue({ entries: [], conflictOperation: 'unknown' })
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
      getStatus: vi.fn().mockResolvedValue({ entries: [], conflictOperation: 'unknown' }),
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

  it('measures mobile Source Control, review, and remount as two local or WSL statuses versus one', async () => {
    mocks.getStatus.mockResolvedValue({ entries: [], conflictOperation: 'unknown' })
    mocks.getGitRepositorySnapshot.mockReturnValue({ revision: 2 })
    const commands = new RuntimeGitCommands({
      resolveRuntimeGitTarget: async () => ({
        worktree: makeWorktree('/workspace/feature'),
        localGitOptions: { wslDistro: 'Ubuntu-24.04' }
      }),
      getRuntimeSettings: () => ({}) as GlobalSettings
    })

    await commands.getRuntimeGitStatus('id:wt-1')
    await commands.getRuntimeGitRepositorySnapshot('id:wt-1')
    await commands.getRuntimeGitStatus('id:wt-1')
    const baseline = {
      status: mocks.getStatus.mock.calls.length,
      snapshot: mocks.getGitRepositorySnapshot.mock.calls.length
    }

    mocks.getStatus.mockClear()
    mocks.getGitRepositorySnapshot.mockClear()
    await commands.getRuntimeGitRepositorySnapshot('id:wt-1')
    await commands.getRuntimeGitStatus('id:wt-1')
    await commands.getRuntimeGitRepositorySnapshot('id:wt-1')
    await commands.getRuntimeGitRepositorySnapshot('id:wt-1')
    const migrated = {
      status: mocks.getStatus.mock.calls.length,
      snapshot: mocks.getGitRepositorySnapshot.mock.calls.length
    }

    expect({ baseline, migrated }).toEqual({
      baseline: { status: 2, snapshot: 1 },
      migrated: { status: 1, snapshot: 3 }
    })
    expect(mocks.getGitRepositorySnapshot).toHaveBeenCalledWith(
      '/workspace/feature',
      { wslDistro: 'Ubuntu-24.04' },
      undefined
    )
    expect(mocks.getGitRepositorySnapshot).toHaveBeenCalledTimes(3)
  })

  it('measures mobile Source Control, review, and remount as two SSH statuses versus one', async () => {
    const provider = {
      getStatus: vi.fn().mockResolvedValue({ entries: [], conflictOperation: 'unknown' }),
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
    await commands.getRuntimeGitRepositorySnapshot('id:wt-1')
    await commands.getRuntimeGitStatus('id:wt-1')
    const baseline = {
      status: provider.getStatus.mock.calls.length,
      snapshot: provider.getRepositorySnapshot.mock.calls.length
    }

    provider.getStatus.mockClear()
    provider.getRepositorySnapshot.mockClear()
    await commands.getRuntimeGitRepositorySnapshot('id:wt-1')
    await commands.getRuntimeGitStatus('id:wt-1')
    await commands.getRuntimeGitRepositorySnapshot('id:wt-1')
    await commands.getRuntimeGitRepositorySnapshot('id:wt-1')
    const migrated = {
      status: provider.getStatus.mock.calls.length,
      snapshot: provider.getRepositorySnapshot.mock.calls.length
    }

    expect({ baseline, migrated }).toEqual({
      baseline: { status: 2, snapshot: 1 },
      migrated: { status: 1, snapshot: 3 }
    })
    expect(provider.getRepositorySnapshot).toHaveBeenCalledWith(
      '/remote/repo',
      undefined,
      undefined
    )
    expect(provider.getRepositorySnapshot).toHaveBeenCalledTimes(3)
  })
})
