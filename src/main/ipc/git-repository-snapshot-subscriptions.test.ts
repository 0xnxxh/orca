import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: never, args: never) => unknown>(),
  localSubscribe: vi.fn(),
  registrySubscribe: vi.fn(),
  resolveLocal: vi.fn(),
  getProvider: vi.fn(),
  getGeneration: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: never, args: never) => unknown) => {
      mocks.handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => {
      mocks.handlers.delete(channel)
    }
  }
}))

vi.mock('../git/status', () => ({
  subscribeGitRepositorySnapshot: mocks.localSubscribe
}))

vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: mocks.getProvider,
  getSshGitProviderGeneration: mocks.getGeneration,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE: 'unavailable',
  subscribeSshGitProviderRegistry: mocks.registrySubscribe
}))

vi.mock('./git-repository-snapshot-request', () => ({
  resolveLocalGitRepositorySnapshotRequest: mocks.resolveLocal
}))

import {
  disposeGitRepositorySnapshotSubscriptionHandlers,
  getGitRepositorySnapshotSubscriptionCountForTests,
  registerGitRepositorySnapshotSubscriptionHandlers
} from './git-repository-snapshot-subscriptions'

type Sender = EventEmitter & {
  id: number
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
}

function sender(id: number): Sender {
  const value = new EventEmitter() as Sender
  value.id = id
  value.isDestroyed = () => false
  value.send = vi.fn()
  return value
}

function handler(channel: string): (event: never, args: never) => Promise<unknown> {
  return mocks.handlers.get(channel) as (event: never, args: never) => Promise<unknown>
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('Git repository snapshot subscription IPC', () => {
  beforeEach(() => {
    disposeGitRepositorySnapshotSubscriptionHandlers()
    mocks.handlers.clear()
    mocks.localSubscribe.mockReset()
    mocks.localSubscribe.mockReturnValue(vi.fn())
    mocks.registrySubscribe.mockReset()
    mocks.registrySubscribe.mockReturnValue(vi.fn())
    mocks.resolveLocal.mockReset()
    mocks.resolveLocal.mockResolvedValue({
      worktreePath: '/resolved/repo',
      options: { includeIgnored: false, sharedLinkPaths: ['/shared'] }
    })
    mocks.getProvider.mockReset()
    mocks.getGeneration.mockReset()
  })

  it('isolates senders and removes exact listeners on unsubscribe and destruction', async () => {
    const ownerListeners: ((event: {
      state: 'ready'
      generation: number
      revision: number
    }) => void)[] = []
    const ownerUnsubscribes = [vi.fn(), vi.fn()]
    mocks.localSubscribe
      .mockImplementationOnce(
        (_path, _options, _target, listener: (typeof ownerListeners)[number]) => {
          ownerListeners.push(listener)
          return ownerUnsubscribes[0]
        }
      )
      .mockImplementationOnce(
        (_path, _options, _target, listener: (typeof ownerListeners)[number]) => {
          ownerListeners.push(listener)
          return ownerUnsubscribes[1]
        }
      )
    registerGitRepositorySnapshotSubscriptionHandlers({} as never)
    const first = sender(1)
    const second = sender(2)

    await handler('git:subscribeRepositorySnapshot')(
      { sender: first } as never,
      { subscriptionId: 'one', worktreePath: '/repo' } as never
    )
    await handler('git:subscribeRepositorySnapshot')(
      { sender: second } as never,
      { subscriptionId: 'two', worktreePath: '/repo' } as never
    )
    expect(mocks.localSubscribe).toHaveBeenNthCalledWith(
      1,
      '/resolved/repo',
      { includeIgnored: false, sharedLinkPaths: ['/shared'] },
      undefined,
      expect.any(Function)
    )
    ownerListeners[0]({ state: 'ready', generation: 2, revision: 3 })

    expect(first.send).toHaveBeenCalledWith('git:repositorySnapshotRevision', {
      subscriptionId: 'one',
      event: { state: 'ready', generation: 2, revision: 3, incarnation: 0 }
    })
    expect(second.send).not.toHaveBeenCalled()
    expect(first.send.mock.calls[0][1]).not.toHaveProperty('worktreePath')

    await handler('git:unsubscribeRepositorySnapshot')(
      { sender: second } as never,
      { subscriptionId: 'one' } as never
    )
    expect(ownerUnsubscribes[0]).not.toHaveBeenCalled()
    await handler('git:unsubscribeRepositorySnapshot')(
      { sender: first } as never,
      { subscriptionId: 'one' } as never
    )
    expect(ownerUnsubscribes[0]).toHaveBeenCalledTimes(1)
    expect(first.listenerCount('destroyed')).toBe(0)

    second.emit('destroyed')
    expect(ownerUnsubscribes[1]).toHaveBeenCalledTimes(1)
    expect(getGitRepositorySnapshotSubscriptionCountForTests()).toBe(0)
  })

  it('rebinds provider incarnations and suppresses late old-provider events', async () => {
    let registryListener!: (event: {
      connectionId: string
      generation: number
      provider: never
    }) => void
    mocks.registrySubscribe.mockImplementation((listener) => {
      registryListener = listener
      return vi.fn()
    })
    const firstListener = vi.fn()
    const secondListener = vi.fn()
    const firstUnsubscribe = vi.fn()
    const secondUnsubscribe = vi.fn()
    const firstProvider = {
      subscribeRepositorySnapshot: vi.fn((_path, _options, _target, listener) => {
        firstListener.mockImplementation(listener)
        return firstUnsubscribe
      })
    }
    const secondProvider = {
      subscribeRepositorySnapshot: vi.fn((_path, _options, _target, listener) => {
        secondListener.mockImplementation(listener)
        return secondUnsubscribe
      })
    }
    mocks.getProvider.mockReturnValue(firstProvider)
    mocks.getGeneration.mockReturnValue(5)
    registerGitRepositorySnapshotSubscriptionHandlers({} as never)
    const target = sender(3)

    await handler('git:subscribeRepositorySnapshot')(
      { sender: target } as never,
      {
        subscriptionId: 'ssh',
        worktreePath: '/repo',
        connectionId: 'connection',
        reuseLineStats: true
      } as never
    )
    firstListener({ state: 'ready', generation: 1, revision: 4 })
    registryListener({
      connectionId: 'connection',
      generation: 6,
      provider: secondProvider as never
    })
    firstListener({ state: 'ready', generation: 1, revision: 5 })
    secondListener({ state: 'ready', generation: 0, revision: 1 })

    expect(firstUnsubscribe).toHaveBeenCalledTimes(1)
    expect(target.send.mock.calls.map((call) => call[1].event)).toEqual([
      { state: 'ready', generation: 1, revision: 4, incarnation: 5 },
      { state: 'invalidated', generation: 0, revision: 0, incarnation: 6 },
      { state: 'ready', generation: 0, revision: 1, incarnation: 6 }
    ])
    disposeGitRepositorySnapshotSubscriptionHandlers()
    expect(secondUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('does not bind an owner after sender destruction during local request resolution', async () => {
    const resolution = deferred<{
      worktreePath: string
      options: { includeIgnored: boolean }
    }>()
    mocks.resolveLocal.mockReturnValue(resolution.promise)
    registerGitRepositorySnapshotSubscriptionHandlers({} as never)
    const target = sender(4)
    let destroyed = false
    target.isDestroyed = () => destroyed

    const pending = handler('git:subscribeRepositorySnapshot')(
      { sender: target } as never,
      { subscriptionId: 'pending', worktreePath: '/repo' } as never
    )
    destroyed = true
    target.emit('destroyed')
    resolution.resolve({ worktreePath: '/repo', options: { includeIgnored: false } })
    await pending

    expect(mocks.localSubscribe).not.toHaveBeenCalled()
    expect(getGitRepositorySnapshotSubscriptionCountForTests()).toBe(0)
  })

  it('closes a subscription when its renderer can no longer receive events', async () => {
    let ownerListener!: (event: { state: 'ready'; generation: number; revision: number }) => void
    const unsubscribe = vi.fn()
    mocks.localSubscribe.mockImplementation((_path, _options, _target, listener) => {
      ownerListener = listener
      return unsubscribe
    })
    registerGitRepositorySnapshotSubscriptionHandlers({} as never)
    const target = sender(5)
    target.send.mockImplementation(() => {
      throw new Error('render frame disposed')
    })
    await handler('git:subscribeRepositorySnapshot')(
      { sender: target } as never,
      { subscriptionId: 'send-failure', worktreePath: '/repo' } as never
    )

    expect(() => ownerListener({ state: 'ready', generation: 1, revision: 1 })).not.toThrow()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(getGitRepositorySnapshotSubscriptionCountForTests()).toBe(0)
  })

  it('does not rebind SSH after replacement invalidation delivery fails', async () => {
    let registryListener!: (event: {
      connectionId: string
      generation: number
      provider: never
    }) => void
    mocks.registrySubscribe.mockImplementation((listener) => {
      registryListener = listener
      return vi.fn()
    })
    const firstUnsubscribe = vi.fn()
    const firstProvider = {
      subscribeRepositorySnapshot: vi.fn(() => firstUnsubscribe)
    }
    const secondProvider = {
      subscribeRepositorySnapshot: vi.fn(() => vi.fn())
    }
    mocks.getProvider.mockReturnValue(firstProvider)
    mocks.getGeneration.mockReturnValue(1)
    registerGitRepositorySnapshotSubscriptionHandlers({} as never)
    const target = sender(6)
    await handler('git:subscribeRepositorySnapshot')(
      { sender: target } as never,
      {
        subscriptionId: 'ssh-send-failure',
        worktreePath: '/repo',
        connectionId: 'connection'
      } as never
    )
    target.send.mockImplementation(() => {
      throw new Error('render frame disposed')
    })

    registryListener({
      connectionId: 'connection',
      generation: 2,
      provider: secondProvider as never
    })

    expect(firstUnsubscribe).toHaveBeenCalledOnce()
    expect(secondProvider.subscribeRepositorySnapshot).not.toHaveBeenCalled()
    expect(getGitRepositorySnapshotSubscriptionCountForTests()).toBe(0)
  })
})
