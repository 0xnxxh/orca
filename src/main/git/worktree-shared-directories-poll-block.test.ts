// Why: `git:status` is polled on a timer, so the shared-directory lookup it performs was the
// highest-frequency `orca.yaml` read in the app. On a stalled repo mount the sync read froze
// the Electron main thread on a timer, with no user action (freeze #9). These tests pin that
// the async path never touches sync fs, single-flights concurrent polls, and serves the last
// known value instead of queueing behind a read that may never return.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { syncCalls, loadHooksAsyncMock, loadHooksMock } = vi.hoisted(() => ({
  syncCalls: [] as string[],
  loadHooksAsyncMock: vi.fn(),
  loadHooksMock: vi.fn()
}))

vi.mock('node:fs', () => {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      syncCalls.push(`${name}:${String(args[0])}`)
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
  return {
    existsSync: vi.fn(record('existsSync')),
    readFileSync: vi.fn(record('readFileSync')),
    statSync: vi.fn(record('statSync')),
    lstatSync: vi.fn(record('lstatSync'))
  }
})

vi.mock('../hooks', () => ({
  loadHooks: loadHooksMock,
  loadHooksAsync: loadHooksAsyncMock
}))

const REPO = '/mnt/stalled-nas/repo'

const hooksWith = (...directories: string[]): { worktree: { sharedDirectories: string[] } } => ({
  worktree: { sharedDirectories: directories }
})

let clearCache: () => void

beforeEach(async () => {
  syncCalls.length = 0
  loadHooksAsyncMock.mockReset()
  loadHooksMock.mockReset()
  ;({ clearConfiguredWorktreeSharedDirectoriesCacheForTests: clearCache } =
    await import('./worktree-shared-directories'))
  clearCache()
})

afterEach(() => {
  clearCache()
})

describe('polled shared-directory lookup never blocks the main thread', () => {
  it('resolves the status-poll link paths with no sync fs call', async () => {
    loadHooksAsyncMock.mockResolvedValue(hooksWith('node_modules'))

    const { getWorktreeSharedLinkPathsAsync } = await import('./worktree-shared-directories')
    await expect(
      getWorktreeSharedLinkPathsAsync({ path: REPO, symlinkPaths: ['.cache'] })
    ).resolves.toEqual(['.cache', 'node_modules'])

    expect(syncCalls).toEqual([])
    expect(loadHooksMock).not.toHaveBeenCalled()
  })

  it('single-flights concurrent pollers into one orca.yaml read', async () => {
    let resolveRead: (hooks: unknown) => void = () => {}
    loadHooksAsyncMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve
      })
    )

    const { getConfiguredWorktreeSharedDirectoriesAsync } =
      await import('./worktree-shared-directories')
    const polls = [
      getConfiguredWorktreeSharedDirectoriesAsync(REPO),
      getConfiguredWorktreeSharedDirectoriesAsync(REPO),
      getConfiguredWorktreeSharedDirectoriesAsync(REPO)
    ]
    resolveRead(hooksWith('node_modules'))

    await expect(Promise.all(polls)).resolves.toEqual([
      ['node_modules'],
      ['node_modules'],
      ['node_modules']
    ])
    expect(loadHooksAsyncMock).toHaveBeenCalledTimes(1)
    expect(syncCalls).toEqual([])
  })

  it('serves the last known value while a stalled refresh is in flight', async () => {
    vi.useFakeTimers()
    try {
      loadHooksAsyncMock.mockResolvedValueOnce(hooksWith('node_modules'))
      const { getConfiguredWorktreeSharedDirectoriesAsync } =
        await import('./worktree-shared-directories')
      await expect(getConfiguredWorktreeSharedDirectoriesAsync(REPO)).resolves.toEqual([
        'node_modules'
      ])

      // The mount goes away: every read after the TTL expires hangs forever.
      loadHooksAsyncMock.mockReturnValue(new Promise(() => {}))
      vi.advanceTimersByTime(30_001)

      for (let poll = 0; poll < 3; poll++) {
        await expect(getConfiguredWorktreeSharedDirectoriesAsync(REPO)).resolves.toEqual([
          'node_modules'
        ])
      }
      // One stuck read, not one per poll.
      expect(loadHooksAsyncMock).toHaveBeenCalledTimes(2)
      expect(syncCalls).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps timers firing while the first-ever read is stuck forever', async () => {
    loadHooksAsyncMock.mockReturnValue(new Promise(() => {}))

    const { getWorktreeSharedLinkPathsAsync } = await import('./worktree-shared-directories')
    let settled = false
    void getWorktreeSharedLinkPathsAsync({ path: REPO }).then(() => {
      settled = true
    })

    const timerFired = await new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(true)
      }, 1)
    })

    expect(timerFired).toBe(true)
    expect(settled).toBe(false)
    expect(syncCalls).toEqual([])
  })

  // Why: the async twin cannot help the sync callers that remain (worktree removal, runtime,
  // cleanup evidence). When the mount dies the refresh never settles, so the entry stays
  // expired forever — and an expired entry used to send those callers straight into the
  // synchronous read on the same dead mount, i.e. the freeze the async twin was added to stop.
  it('serves sync callers the last known value while a refresh is stuck on the mount', async () => {
    vi.useFakeTimers()
    try {
      loadHooksAsyncMock.mockResolvedValueOnce(hooksWith('node_modules'))
      const {
        getConfiguredWorktreeSharedDirectories,
        getConfiguredWorktreeSharedDirectoriesAsync,
        getWorktreeSharedLinkPaths
      } = await import('./worktree-shared-directories')
      await getConfiguredWorktreeSharedDirectoriesAsync(REPO)

      loadHooksAsyncMock.mockReturnValue(new Promise(() => {}))
      vi.advanceTimersByTime(30_001)
      void getConfiguredWorktreeSharedDirectoriesAsync(REPO)

      expect(getConfiguredWorktreeSharedDirectories(REPO)).toEqual(['node_modules'])
      expect(getWorktreeSharedLinkPaths({ path: REPO, symlinkPaths: ['.cache'] })).toEqual([
        '.cache',
        'node_modules'
      ])
      // The sync read is the block: it must never be reached while the mount is unanswered.
      expect(loadHooksMock).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  // Why: the refresh map only orders async reads against each other. The sync twin writes the
  // same cache entry without consulting it, so a read that started earlier could land later,
  // overwrite the newer value, and stamp a fresh 30s TTL on the stale one.
  it('does not let a slow refresh clobber a value the sync twin published after it started', async () => {
    let resolveRead: (hooks: unknown) => void = () => {}
    loadHooksAsyncMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve
      })
    )

    const { getConfiguredWorktreeSharedDirectories, getConfiguredWorktreeSharedDirectoriesAsync } =
      await import('./worktree-shared-directories')
    const poll = getConfiguredWorktreeSharedDirectoriesAsync(REPO)

    loadHooksMock.mockReturnValue(hooksWith('.venv'))
    expect(getConfiguredWorktreeSharedDirectories(REPO)).toEqual(['.venv'])

    resolveRead(hooksWith('node_modules'))
    await expect(poll).resolves.toEqual(['.venv'])
    expect(getConfiguredWorktreeSharedDirectories(REPO)).toEqual(['.venv'])
  })

  it('refreshes again after a failed read instead of caching the failure', async () => {
    loadHooksAsyncMock.mockRejectedValueOnce(new Error('EIO'))
    const { getConfiguredWorktreeSharedDirectoriesAsync } =
      await import('./worktree-shared-directories')
    await expect(getConfiguredWorktreeSharedDirectoriesAsync(REPO)).resolves.toEqual([])

    loadHooksAsyncMock.mockResolvedValueOnce(hooksWith('node_modules'))
    await expect(getConfiguredWorktreeSharedDirectoriesAsync(REPO)).resolves.toEqual([
      'node_modules'
    ])
  })
})
