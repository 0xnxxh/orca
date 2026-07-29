import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ParcelWatcherProcess from './parcel-watcher-process'

const { handleMock } = vi.hoisted(() => ({
  handleMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock
  }
}))

vi.mock('fs/promises', () => ({
  stat: vi.fn()
}))

vi.mock('@parcel/watcher', () => ({
  subscribe: vi.fn()
}))

vi.mock('./filesystem-watcher-wsl', () => ({
  createWslWatcher: vi.fn()
}))

vi.mock('./parcel-watcher-process', async (importOriginal) => {
  const actual = await importOriginal<typeof ParcelWatcherProcess>()
  return {
    ...actual,
    subscribeViaWatcherProcess: vi.fn(actual.subscribeViaWatcherProcess)
  }
})

vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  getSshFilesystemProvider: vi.fn(),
  onSshFilesystemProviderRegistered: () => () => {}
}))

import {
  closeAllWatchers,
  closeLocalWatcherForWorktreePath,
  registerFilesystemWatcherHandlers
} from './filesystem-watcher'
import {
  createWatcherRemovalDeadline,
  WATCHER_REMOVAL_DRAIN_BUDGET_MS
} from './watcher-removal-drain'
import { stat } from 'node:fs/promises'
import { subscribe as subscribeParcelWatcher } from '@parcel/watcher'
import { subscribeViaWatcherProcess } from './parcel-watcher-process'

type HandlerMap = Record<string, (_event: unknown, args: unknown) => Promise<unknown> | unknown>

describe('local filesystem watcher removal deadline', () => {
  const handlers: HandlerMap = {}

  beforeEach(async () => {
    handleMock.mockReset()
    vi.mocked(stat).mockReset()
    vi.mocked(subscribeParcelWatcher).mockReset()
    vi.mocked(subscribeViaWatcherProcess).mockClear()
    for (const key of Object.keys(handlers)) {
      delete handlers[key]
    }
    handleMock.mockImplementation((channel, handler) => {
      handlers[channel] = handler
    })
    registerFilesystemWatcherHandlers()
    await closeAllWatchers()
  })

  afterEach(async () => {
    await closeAllWatchers()
  })

  it('bounds a wedged watcher install so worktree deletion cannot hang forever', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never)
      // Why mock the process-backed subscribe: the in-process fallback rejects on abort, so only a
      // subscribe that ignores the abort signal exercises the deadline rather than the cancel path.
      // Once, so the wedge cannot leak into the next test.
      vi.mocked(subscribeViaWatcherProcess).mockImplementationOnce(() => new Promise(() => {}))
      const sender = {
        isDestroyed: () => false,
        send: vi.fn(),
        once: vi.fn(),
        id: 1
      }

      const watchPromise = handlers['fs:watchWorktree'](
        { sender },
        { worktreePath: '/tmp/repo' }
      ) as Promise<unknown>
      await vi.waitFor(() => {
        expect(subscribeViaWatcherProcess).toHaveBeenCalled()
      })

      let closed = false
      const closePromise = closeLocalWatcherForWorktreePath('/tmp/repo').then(() => {
        closed = true
      })

      await vi.advanceTimersByTimeAsync(WATCHER_REMOVAL_DRAIN_BUDGET_MS - 1)
      expect(closed).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await closePromise
      expect(closed).toBe(true)

      void watchPromise
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a wedged live unsubscribe so worktree deletion cannot hang forever', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never)
    // The in-process Parcel fallback has no unsubscribe timeout of its own, so only the shared
    // removal deadline can stop this from hanging delete forever.
    let resolveUnsubscribe: () => void = () => {}
    const unsubscribeMock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveUnsubscribe = resolve
        })
    )
    vi.mocked(subscribeParcelWatcher).mockResolvedValue({ unsubscribe: unsubscribeMock } as never)
    const sender = { isDestroyed: () => false, send: vi.fn(), once: vi.fn(), id: 1 }

    await handlers['fs:watchWorktree']({ sender }, { worktreePath: '/tmp/repo' })

    vi.useFakeTimers()
    try {
      let closed = false
      const closePromise = closeLocalWatcherForWorktreePath('/tmp/repo').then(() => {
        closed = true
      })
      await vi.advanceTimersByTimeAsync(WATCHER_REMOVAL_DRAIN_BUDGET_MS - 1)
      expect(unsubscribeMock).toHaveBeenCalledTimes(1)
      expect(closed).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await closePromise
      expect(closed).toBe(true)
    } finally {
      resolveUnsubscribe()
      vi.useRealTimers()
    }
  })

  it('spends one shared budget across both drains instead of one per await', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never)
      vi.mocked(subscribeViaWatcherProcess).mockImplementationOnce(() => new Promise(() => {}))
      const sender = {
        isDestroyed: () => false,
        send: vi.fn(),
        once: vi.fn(),
        id: 1
      }

      const watchPromise = handlers['fs:watchWorktree'](
        { sender },
        { worktreePath: '/tmp/repo' }
      ) as Promise<unknown>
      await vi.waitFor(() => {
        expect(subscribeViaWatcherProcess).toHaveBeenCalled()
      })

      // Half the budget is already gone before the close starts; the drain may only spend the rest.
      const deadline = createWatcherRemovalDeadline()
      await vi.advanceTimersByTimeAsync(WATCHER_REMOVAL_DRAIN_BUDGET_MS / 2)

      let closed = false
      const closePromise = closeLocalWatcherForWorktreePath('/tmp/repo', deadline).then(() => {
        closed = true
      })
      await vi.advanceTimersByTimeAsync(WATCHER_REMOVAL_DRAIN_BUDGET_MS / 2)
      await closePromise
      expect(closed).toBe(true)

      void watchPromise
    } finally {
      vi.useRealTimers()
    }
  })
})
