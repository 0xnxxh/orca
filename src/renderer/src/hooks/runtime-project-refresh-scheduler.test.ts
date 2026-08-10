import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRuntimeProjectRefreshScheduler,
  refreshRuntimeProjectCatalog,
  refreshRuntimeProjectWorktrees
} from './runtime-project-refresh-scheduler'

describe('refreshRuntimeProjectWorktrees', () => {
  it('pins same-ID repo refreshes to the event runtime', async () => {
    const fetchWorktrees = vi.fn().mockResolvedValue(true)

    await refreshRuntimeProjectWorktrees(
      'env-1',
      [{ id: 'same-repo' }, { id: 'same-repo' }],
      fetchWorktrees
    )

    expect(fetchWorktrees).toHaveBeenCalledTimes(2)
    expect(fetchWorktrees).toHaveBeenNthCalledWith(1, 'same-repo', {
      executionHostId: 'runtime:env-1',
      deferRemoteLineageRefresh: true
    })
    expect(fetchWorktrees).toHaveBeenNthCalledWith(2, 'same-repo', {
      executionHostId: 'runtime:env-1',
      deferRemoteLineageRefresh: true
    })
  })

  it('refreshes host-wide lineage once after a large repo batch', async () => {
    const fetchWorktrees = vi.fn().mockResolvedValue(true)
    const fetchLineage = vi.fn().mockResolvedValue(undefined)
    const repos = Array.from({ length: 40 }, (_, index) => ({ id: `repo-${index}` }))

    await refreshRuntimeProjectCatalog('env-1', repos, fetchWorktrees, fetchLineage)

    expect(fetchWorktrees).toHaveBeenCalledTimes(40)
    for (const [repoId, options] of fetchWorktrees.mock.calls) {
      expect(repoId).toMatch(/^repo-\d+$/)
      expect(options).toEqual({
        executionHostId: 'runtime:env-1',
        deferRemoteLineageRefresh: true
      })
    }
    expect(fetchLineage).toHaveBeenCalledOnce()
    expect(fetchLineage).toHaveBeenCalledWith({ executionHostId: 'runtime:env-1' })
  })

  it('refreshes host-wide lineage when the host has no repos', async () => {
    const fetchWorktrees = vi.fn()
    const fetchLineage = vi.fn().mockResolvedValue(undefined)

    await refreshRuntimeProjectCatalog('env-1', [], fetchWorktrees, fetchLineage)

    expect(fetchWorktrees).not.toHaveBeenCalled()
    expect(fetchLineage).toHaveBeenCalledOnce()
    expect(fetchLineage).toHaveBeenCalledWith({ executionHostId: 'runtime:env-1' })
  })

  it('still refreshes host-wide lineage when a repo callback rejects', async () => {
    const fetchWorktrees = vi.fn((repoId: string) =>
      repoId === 'repo-b' ? Promise.reject(new Error('scan failed')) : Promise.resolve(true)
    )
    const fetchLineage = vi.fn().mockResolvedValue(undefined)

    await expect(
      refreshRuntimeProjectCatalog(
        'env-1',
        [{ id: 'repo-a' }, { id: 'repo-b' }],
        fetchWorktrees,
        fetchLineage
      )
    ).rejects.toThrow('Failed to refresh 1 runtime project worktree(s): repo-b')

    expect(fetchWorktrees).toHaveBeenCalledTimes(2)
    expect(fetchLineage).toHaveBeenCalledOnce()
    expect(fetchLineage).toHaveBeenCalledWith({ executionHostId: 'runtime:env-1' })
  })
})

describe('createRuntimeProjectRefreshScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces a burst of remote repo events into one refresh', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const scheduler = createRuntimeProjectRefreshScheduler({
      refresh,
      debounceMs: 100,
      minIntervalMs: 1_000
    })

    scheduler.request('env-1')
    scheduler.request('env-1')
    scheduler.request('env-1')

    await vi.advanceTimersByTimeAsync(99)
    expect(refresh).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith('env-1')

    scheduler.stop()
  })

  it('throttles repeated bursts after the first refresh', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const scheduler = createRuntimeProjectRefreshScheduler({
      refresh,
      debounceMs: 100,
      minIntervalMs: 1_000
    })

    scheduler.request('env-1')
    await vi.advanceTimersByTimeAsync(100)
    expect(refresh).toHaveBeenCalledTimes(1)

    scheduler.request('env-1')
    scheduler.request('env-1')
    await vi.advanceTimersByTimeAsync(999)
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(2)

    scheduler.stop()
  })

  it('waits for an in-flight refresh before running a pending follow-up', async () => {
    let finishRefresh = (): void => {
      throw new Error('Expected refresh promise resolver to be set')
    }
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve
        })
    )
    const scheduler = createRuntimeProjectRefreshScheduler({
      refresh,
      debounceMs: 100,
      minIntervalMs: 1_000
    })

    scheduler.request('env-1')
    await vi.advanceTimersByTimeAsync(100)
    expect(refresh).toHaveBeenCalledTimes(1)

    scheduler.request('env-1')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(refresh).toHaveBeenCalledTimes(1)

    finishRefresh()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(100)
    expect(refresh).toHaveBeenCalledTimes(2)

    scheduler.stop()
  })

  it('clears pending timers on stop', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const scheduler = createRuntimeProjectRefreshScheduler({
      refresh,
      debounceMs: 100,
      minIntervalMs: 1_000
    })

    scheduler.request('env-1')
    scheduler.stop()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(refresh).not.toHaveBeenCalled()
  })
})
