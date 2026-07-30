// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitRepositorySnapshotSubscriptionEvent } from '../../../../shared/git-repository-snapshot'
import { useChecksPanelRepositorySnapshotRevision } from './use-checks-panel-repository-snapshot-revision'

const subscribe = vi.fn()
const subscribeRuntime = vi.fn()
const runtimeTargetKey = vi.fn()

vi.mock('@/runtime/desktop-git-repository-snapshot-client', () => ({
  subscribeDesktopGitRepositorySnapshot: (
    ...args: Parameters<typeof subscribe>
  ): ReturnType<typeof subscribe> => subscribe(...args)
}))

vi.mock('@/runtime/runtime-git-repository-snapshot-revision-client', () => ({
  getRuntimeGitRepositorySnapshotRevisionTargetKey: (...args: unknown[]) =>
    runtimeTargetKey(...args),
  subscribeRuntimeGitRepositorySnapshotRevision: (
    ...args: Parameters<typeof subscribeRuntime>
  ): ReturnType<typeof subscribeRuntime> => subscribeRuntime(...args)
}))

const context = {
  settings: { activeRuntimeEnvironmentId: null },
  worktreeId: 'wt-1',
  worktreePath: '/repo'
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('useChecksPanelRepositorySnapshotRevision', () => {
  beforeEach(() => {
    subscribe.mockReset()
    subscribeRuntime.mockReset()
    runtimeTargetKey.mockReset()
    runtimeTargetKey.mockReturnValue(null)
  })

  it('subscribes to both polling identities and tears down on context change', async () => {
    const unsubscribes = [vi.fn(), vi.fn(), vi.fn(), vi.fn()]
    subscribe.mockImplementation(async () => ({
      unsubscribe: unsubscribes[subscribe.mock.calls.length - 1]
    }))
    const requestRefresh = vi.fn()
    const { rerender, unmount } = renderHook(
      ({ contextKey }) =>
        useChecksPanelRepositorySnapshotRevision({
          context,
          contextKey,
          enabled: true,
          pushTarget: null,
          requestRefresh
        }),
      { initialProps: { contextKey: 'one' } }
    )

    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2))
    expect(subscribe.mock.calls.map((call) => call[1])).toEqual([{}, { reuseLineStats: true }])

    rerender({ contextKey: 'two' })
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(4))
    expect(unsubscribes[0]).toHaveBeenCalledOnce()
    expect(unsubscribes[1]).toHaveBeenCalledOnce()

    unmount()
    expect(unsubscribes[2]).toHaveBeenCalledOnce()
    expect(unsubscribes[3]).toHaveBeenCalledOnce()
  })

  it('coalesces ready delivery and consumes self-publication without another refresh', async () => {
    const callbacks: ((event: GitRepositorySnapshotSubscriptionEvent) => void)[] = []
    subscribe.mockImplementation(async (_context, _options, callback) => {
      callbacks.push(callback)
      return { unsubscribe: vi.fn() }
    })
    const requestRefresh = vi.fn()
    const { result } = renderHook(() =>
      useChecksPanelRepositorySnapshotRevision({
        context,
        contextKey: 'one',
        enabled: true,
        pushTarget: null,
        requestRefresh
      })
    )
    await waitFor(() => expect(callbacks).toHaveLength(2))
    const ready = { state: 'ready', generation: 0, revision: 1, incarnation: 0 } as const

    act(() => {
      callbacks[0](ready)
      callbacks[1](ready)
    })
    expect(requestRefresh).toHaveBeenCalledOnce()

    let read = 0
    act(() => {
      read = result.current.beginRead()
    })
    act(() => callbacks[0]({ ...ready, revision: 2 }))
    expect(result.current.finishRead(read, 2)).toBe(false)
    expect(requestRefresh).toHaveBeenCalledOnce()
  })

  it('does not subscribe while disabled and cleans a partial subscription failure', async () => {
    const unsubscribe = vi.fn()
    subscribe.mockResolvedValueOnce({ unsubscribe }).mockRejectedValueOnce(new Error('unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { rerender } = renderHook(
      ({ enabled }) =>
        useChecksPanelRepositorySnapshotRevision({
          context,
          contextKey: 'one',
          enabled,
          pushTarget: null,
          requestRefresh: vi.fn()
        }),
      { initialProps: { enabled: false } }
    )

    expect(subscribe).not.toHaveBeenCalled()
    rerender({ enabled: true })
    await waitFor(() => expect(warn).toHaveBeenCalledOnce())
    expect(unsubscribe).toHaveBeenCalledOnce()
    rerender({ enabled: false })
    expect(unsubscribe).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('cleans a settled handle while the sibling subscription is still pending', async () => {
    const pending = deferred<{ unsubscribe: () => void }>()
    const firstUnsubscribe = vi.fn()
    const secondUnsubscribe = vi.fn()
    subscribe
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ unsubscribe: secondUnsubscribe })
    const { unmount } = renderHook(() =>
      useChecksPanelRepositorySnapshotRevision({
        context,
        contextKey: 'one',
        enabled: true,
        pushTarget: null,
        requestRefresh: vi.fn()
      })
    )
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2))

    unmount()
    expect(secondUnsubscribe).toHaveBeenCalledOnce()
    pending.resolve({ unsubscribe: firstUnsubscribe })
    await waitFor(() => expect(firstUnsubscribe).toHaveBeenCalledOnce())
  })

  it('suppresses runtime polling only after both registrations and an admitted event read', async () => {
    runtimeTargetKey.mockReturnValue('env-1\\08\\0id:wt-1')
    const callbacks: {
      onSubscribed: (incarnation: number) => void
      onRevision: (event: GitRepositorySnapshotSubscriptionEvent) => void
      onReplay: () => void
    }[] = []
    const unsubscribes = [vi.fn(), vi.fn()]
    subscribeRuntime.mockImplementation(async (_context, _options, nextCallbacks) => {
      callbacks.push(nextCallbacks)
      return { unsubscribe: unsubscribes[callbacks.length - 1] }
    })
    const requestRefresh = vi.fn()
    const runtimeContext = {
      ...context,
      settings: { activeRuntimeEnvironmentId: 'env-1' }
    }
    const { result, unmount } = renderHook(() =>
      useChecksPanelRepositorySnapshotRevision({
        context: runtimeContext,
        contextKey: 'runtime-one',
        enabled: false,
        runtimeEnabled: true,
        pushTarget: null,
        requestRefresh
      })
    )
    await waitFor(() => expect(callbacks).toHaveLength(2))
    expect(result.current.runtimeSnapshotPollingRequired).toBe(true)

    act(() => callbacks[0]?.onSubscribed(3))
    act(() =>
      callbacks[0]?.onRevision({
        state: 'ready',
        generation: 1,
        revision: 4,
        incarnation: 3
      })
    )
    expect(requestRefresh).not.toHaveBeenCalled()
    act(() => callbacks[1]?.onSubscribed(3))
    act(() =>
      callbacks[0]?.onRevision({
        state: 'ready',
        generation: 1,
        revision: 5,
        incarnation: 3
      })
    )
    expect(requestRefresh).toHaveBeenCalledOnce()

    let read = 0
    act(() => {
      read = result.current.beginRead()
    })
    act(() => {
      result.current.finishRead(read, 5, true)
    })
    expect(result.current.runtimeSnapshotPollingRequired).toBe(false)

    act(() =>
      callbacks[1]?.onRevision({
        state: 'invalidated',
        generation: 2,
        revision: 5,
        incarnation: 3
      })
    )
    expect(result.current.runtimeSnapshotPollingRequired).toBe(true)
    unmount()
    await waitFor(() => {
      expect(unsubscribes[0]).toHaveBeenCalledOnce()
      expect(unsubscribes[1]).toHaveBeenCalledOnce()
    })
  })

  it('coalesces StrictMode registration and does not retry an unsupported runtime context', async () => {
    runtimeTargetKey.mockReturnValue('env-1\\08\\0id:wt-1')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    subscribeRuntime
      .mockRejectedValueOnce(new Error('method_not_found'))
      .mockResolvedValueOnce({ unsubscribe: vi.fn() })
    const runtimeContext = {
      ...context,
      settings: { activeRuntimeEnvironmentId: 'env-1' }
    }
    const { rerender } = renderHook(
      () =>
        useChecksPanelRepositorySnapshotRevision({
          context: runtimeContext,
          contextKey: 'runtime-one',
          enabled: false,
          runtimeEnabled: true,
          pushTarget: null,
          requestRefresh: vi.fn()
        }),
      { wrapper: StrictMode }
    )

    await waitFor(() => expect(warn).toHaveBeenCalledOnce())
    expect(subscribeRuntime).toHaveBeenCalledTimes(2)
    rerender()
    await Promise.resolve()
    expect(subscribeRuntime).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('fails open until both runtime identities reach the ready event incarnation', async () => {
    runtimeTargetKey.mockReturnValue('env-1\\08\\0id:wt-1')
    const callbacks: {
      onSubscribed: (incarnation: number) => void
      onRevision: (event: GitRepositorySnapshotSubscriptionEvent) => void
    }[] = []
    subscribeRuntime.mockImplementation(async (_context, _options, nextCallbacks) => {
      callbacks.push(nextCallbacks)
      return { unsubscribe: vi.fn() }
    })
    const requestRefresh = vi.fn()
    const { result } = renderHook(() =>
      useChecksPanelRepositorySnapshotRevision({
        context: { ...context, settings: { activeRuntimeEnvironmentId: 'env-1' } },
        contextKey: 'runtime-one',
        enabled: false,
        runtimeEnabled: true,
        pushTarget: null,
        requestRefresh
      })
    )
    await waitFor(() => expect(callbacks).toHaveLength(2))

    act(() => {
      callbacks[0]?.onSubscribed(4)
      callbacks[1]?.onSubscribed(4)
      callbacks[0]?.onRevision({
        state: 'invalidated',
        generation: 0,
        revision: 0,
        incarnation: 5
      })
      callbacks[0]?.onRevision({
        state: 'ready',
        generation: 0,
        revision: 1,
        incarnation: 5
      })
    })
    act(() => {
      const read = result.current.beginRead()
      result.current.finishRead(read, 1, true)
    })
    expect(requestRefresh).not.toHaveBeenCalled()
    expect(result.current.runtimeSnapshotPollingRequired).toBe(true)

    act(() => {
      callbacks[1]?.onRevision({
        state: 'invalidated',
        generation: 0,
        revision: 0,
        incarnation: 5
      })
      callbacks[0]?.onRevision({
        state: 'ready',
        generation: 0,
        revision: 2,
        incarnation: 5
      })
    })
    expect(requestRefresh).toHaveBeenCalledOnce()
    act(() => {
      const read = result.current.beginRead()
      result.current.finishRead(read, 2, true)
    })
    expect(result.current.runtimeSnapshotPollingRequired).toBe(false)
  })

  it('requires new registration and admission after visibility disables the stream', async () => {
    runtimeTargetKey.mockReturnValue('env-1\\08\\0id:wt-1')
    const callbacks: {
      onSubscribed: (incarnation: number) => void
      onRevision: (event: GitRepositorySnapshotSubscriptionEvent) => void
    }[] = []
    subscribeRuntime.mockImplementation(async (_context, _options, nextCallbacks) => {
      callbacks.push(nextCallbacks)
      return { unsubscribe: vi.fn() }
    })
    const runtimeContext = {
      ...context,
      settings: { activeRuntimeEnvironmentId: 'env-1' }
    }
    const { result, rerender } = renderHook(
      ({ runtimeEnabled }) =>
        useChecksPanelRepositorySnapshotRevision({
          context: runtimeContext,
          contextKey: 'runtime-one',
          enabled: false,
          runtimeEnabled,
          pushTarget: null,
          requestRefresh: vi.fn()
        }),
      { initialProps: { runtimeEnabled: true } }
    )
    await waitFor(() => expect(callbacks).toHaveLength(2))
    act(() => {
      callbacks[0]?.onSubscribed(3)
      callbacks[1]?.onSubscribed(3)
      callbacks[0]?.onRevision({
        state: 'ready',
        generation: 1,
        revision: 5,
        incarnation: 3
      })
    })
    act(() => {
      const read = result.current.beginRead()
      result.current.finishRead(read, 5, true)
    })
    expect(result.current.runtimeSnapshotPollingRequired).toBe(false)

    rerender({ runtimeEnabled: false })
    expect(result.current.runtimeSnapshotPollingRequired).toBe(true)
    rerender({ runtimeEnabled: true })
    expect(result.current.runtimeSnapshotPollingRequired).toBe(true)
    await waitFor(() => expect(subscribeRuntime).toHaveBeenCalledTimes(4))
  })

  it('replaces both runtime identities on an exact context or push-target change', async () => {
    runtimeTargetKey.mockReturnValue('env-1\\08\\0id:wt-1')
    const unsubscribes = [vi.fn(), vi.fn(), vi.fn(), vi.fn()]
    subscribeRuntime.mockImplementation(async () => ({
      unsubscribe: unsubscribes[subscribeRuntime.mock.calls.length - 1]
    }))
    const runtimeContext = {
      ...context,
      settings: { activeRuntimeEnvironmentId: 'env-1' }
    }
    const { rerender } = renderHook(
      ({ contextKey, branchName }) =>
        useChecksPanelRepositorySnapshotRevision({
          context: runtimeContext,
          contextKey,
          enabled: false,
          runtimeEnabled: true,
          pushTarget: {
            remoteName: 'fork',
            branchName,
            remoteCreated: false
          },
          requestRefresh: vi.fn()
        }),
      { initialProps: { contextKey: 'runtime-one', branchName: 'feature/one' } }
    )
    await waitFor(() => expect(subscribeRuntime).toHaveBeenCalledTimes(2))

    rerender({ contextKey: 'runtime-two', branchName: 'feature/two' })
    await waitFor(() => expect(subscribeRuntime).toHaveBeenCalledTimes(4))
    expect(unsubscribes[0]).toHaveBeenCalledOnce()
    expect(unsubscribes[1]).toHaveBeenCalledOnce()
    expect(subscribeRuntime.mock.calls.slice(2).map((call) => call[1])).toEqual([
      {
        pushTarget: {
          remoteName: 'fork',
          branchName: 'feature/two',
          remoteCreated: false
        }
      },
      {
        pushTarget: {
          remoteName: 'fork',
          branchName: 'feature/two',
          remoteCreated: false
        },
        reuseLineStats: true
      }
    ])
  })

  it('fails open on replay, partial registration, and inadmissible event reads', async () => {
    runtimeTargetKey.mockReturnValue('env-1\\08\\0id:wt-1')
    const callbacks: {
      onSubscribed: (incarnation: number) => void
      onRevision: (event: GitRepositorySnapshotSubscriptionEvent) => void
      onReplay: () => void
      onUnavailable: (error: unknown) => void
    }[] = []
    subscribeRuntime.mockImplementation(async (_context, _options, nextCallbacks) => {
      callbacks.push(nextCallbacks)
      return { unsubscribe: vi.fn() }
    })
    const requestRefresh = vi.fn()
    const { result } = renderHook(() =>
      useChecksPanelRepositorySnapshotRevision({
        context: { ...context, settings: { activeRuntimeEnvironmentId: 'env-1' } },
        contextKey: 'runtime-one',
        enabled: false,
        runtimeEnabled: true,
        pushTarget: null,
        requestRefresh
      })
    )
    await waitFor(() => expect(callbacks).toHaveLength(2))
    act(() => {
      callbacks[0]?.onSubscribed(2)
      callbacks[1]?.onSubscribed(2)
      callbacks[0]?.onRevision({
        state: 'ready',
        generation: 1,
        revision: 3,
        incarnation: 2
      })
    })
    let read = 0
    act(() => {
      read = result.current.beginRead()
      result.current.finishRead(read, null, false)
    })
    expect(result.current.runtimeSnapshotPollingRequired).toBe(true)

    act(() => callbacks[0]?.onReplay())
    act(() => callbacks[0]?.onSubscribed(2))
    act(() =>
      callbacks[0]?.onRevision({
        state: 'ready',
        generation: 1,
        revision: 4,
        incarnation: 2
      })
    )
    expect(requestRefresh).toHaveBeenCalledOnce()
    expect(result.current.runtimeSnapshotPollingRequired).toBe(true)

    act(() => {
      callbacks[1]?.onReplay()
      callbacks[1]?.onSubscribed(2)
      callbacks[0]?.onRevision({
        state: 'ready',
        generation: 1,
        revision: 5,
        incarnation: 2
      })
    })
    expect(requestRefresh).toHaveBeenCalledTimes(2)
    act(() => {
      read = result.current.beginRead()
      result.current.finishRead(read, 5, true)
    })
    expect(result.current.runtimeSnapshotPollingRequired).toBe(false)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    act(() => callbacks[1]?.onUnavailable(new Error('stream closed')))
    expect(result.current.runtimeSnapshotPollingRequired).toBe(true)
    warn.mockRestore()
  })
})
