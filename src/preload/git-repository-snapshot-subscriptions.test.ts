import { describe, expect, it, vi } from 'vitest'
import { subscribeGitRepositorySnapshotFromPreload } from './git-repository-snapshot-subscriptions'

type Payload = {
  subscriptionId: string
  event: {
    state: 'ready' | 'invalidated'
    generation: number
    revision: number
    incarnation: number
  }
}

function createIpc() {
  const listeners = new Set<(event: unknown, payload: Payload) => void>()
  return {
    invoke: vi.fn(async (_channel: string, args: unknown) => args),
    on: vi.fn((_channel: string, listener: (event: unknown, payload: Payload) => void) => {
      listeners.add(listener)
    }),
    removeListener: vi.fn(
      (_channel: string, listener: (event: unknown, payload: Payload) => void) => {
        listeners.delete(listener)
      }
    ),
    emit: (payload: Payload): void => {
      for (const listener of Array.from(listeners)) {
        listener(null, payload)
      }
    },
    listenerCount: (): number => listeners.size
  }
}

describe('subscribeGitRepositorySnapshotFromPreload', () => {
  it('installs exact listeners before subscribe and isolates callback ids', async () => {
    const ipc = createIpc()
    const first = vi.fn()
    const second = vi.fn()

    const firstHandle = await subscribeGitRepositorySnapshotFromPreload(
      ipc,
      { worktreePath: '/one' },
      first,
      () => 'sub-1'
    )
    const secondHandle = await subscribeGitRepositorySnapshotFromPreload(
      ipc,
      { worktreePath: '/two' },
      second,
      () => 'sub-2'
    )

    expect(ipc.on).toHaveBeenCalledTimes(2)
    expect(ipc.on.mock.invocationCallOrder[0]).toBeLessThan(ipc.invoke.mock.invocationCallOrder[0])
    ipc.emit({
      subscriptionId: 'sub-2',
      event: { state: 'ready', generation: 1, revision: 2, incarnation: 3 }
    })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)

    firstHandle.unsubscribe()
    expect(ipc.listenerCount()).toBe(1)
    secondHandle.unsubscribe()
    expect(ipc.listenerCount()).toBe(0)
    expect(ipc.invoke).toHaveBeenCalledWith('git:unsubscribeRepositorySnapshot', {
      subscriptionId: 'sub-2'
    })
  })

  it('releases the dispatcher when subscribe rejects', async () => {
    const ipc = createIpc()
    ipc.invoke.mockRejectedValueOnce(new Error('unavailable'))

    await expect(
      subscribeGitRepositorySnapshotFromPreload(
        ipc,
        { worktreePath: '/repo' },
        vi.fn(),
        () => 'sub-error'
      )
    ).rejects.toThrow('unavailable')

    expect(ipc.listenerCount()).toBe(0)
    expect(ipc.removeListener).toHaveBeenCalledTimes(1)
  })

  it('makes explicit unsubscribe idempotent', async () => {
    const ipc = createIpc()
    const handle = await subscribeGitRepositorySnapshotFromPreload(
      ipc,
      { worktreePath: '/repo' },
      vi.fn(),
      () => 'sub-1'
    )

    handle.unsubscribe()
    handle.unsubscribe()

    expect(ipc.invoke).toHaveBeenCalledTimes(2)
  })
})
