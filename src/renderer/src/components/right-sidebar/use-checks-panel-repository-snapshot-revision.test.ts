// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitRepositorySnapshotSubscriptionEvent } from '../../../../shared/git-repository-snapshot'
import { useChecksPanelRepositorySnapshotRevision } from './use-checks-panel-repository-snapshot-revision'

const subscribe = vi.fn()

vi.mock('@/runtime/desktop-git-repository-snapshot-client', () => ({
  subscribeDesktopGitRepositorySnapshot: (
    ...args: Parameters<typeof subscribe>
  ): ReturnType<typeof subscribe> => subscribe(...args)
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
})
