import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir: string

const { removeHostTreeMock, deleteWslFishHistoryFileMock } = vi.hoisted(() => ({
  removeHostTreeMock: vi.fn<(dir: string) => Promise<void>>(),
  deleteWslFishHistoryFileMock: vi.fn<(distro: string, session: string) => Promise<void>>()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

vi.mock('./host-tree-removal', () => ({
  removeHostTree: removeHostTreeMock
}))

vi.mock('./wsl-fish-history-cleanup', () => ({
  deleteWslFishHistoryFile: deleteWslFishHistoryFileMock
}))

import { hashWorktreeId } from './terminal-history-paths'
import { fishHistorySessionName } from './fish-history-session'
import {
  cancelPendingHistoryTreeRemovalRetries,
  deleteWorktreeHistoryDir,
  flushPendingWorktreeHistoryDeletions,
  MAX_PENDING_HISTORY_TREE_REMOVALS,
  HISTORY_TREE_REMOVAL_RETRY_DELAYS_MS,
  schedulePendingHistoryTreeRemovals
} from './terminal-history-deletion'

/** A tombstone whose rm fails once used to sit on disk for the rest of the session — only the next
 *  process start re-queued it. Prove the failure re-arms in-process, and that it stays bounded. */
describe('tombstoned history removal retries', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'orca-history-retry-'))
    removeHostTreeMock.mockReset()
    deleteWslFishHistoryFileMock.mockReset()
    deleteWslFishHistoryFileMock.mockResolvedValue(undefined)
    removeHostTreeMock.mockImplementation(async (dir) => {
      rmSync(dir, { recursive: true, force: true })
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    cancelPendingHistoryTreeRemovalRetries()
    vi.useRealTimers()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  function seedWorktreeHistory(worktreeId: string): void {
    const dir = join(userDataDir, 'terminal-history', hashWorktreeId(worktreeId))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'meta.json'), '{}')
  }

  it('re-queues a tombstone whose removal failed, then stops after the last attempt', async () => {
    seedWorktreeHistory('repo-1::/path/busy-wt')
    const busy = Object.assign(new Error('resource busy'), { code: 'EBUSY' })
    removeHostTreeMock.mockRejectedValue(busy)

    deleteWorktreeHistoryDir('repo-1::/path/busy-wt')
    await vi.advanceTimersByTimeAsync(0)
    expect(removeHostTreeMock).toHaveBeenCalledTimes(1)

    for (const [index, retryDelayMs] of HISTORY_TREE_REMOVAL_RETRY_DELAYS_MS.entries()) {
      await vi.advanceTimersByTimeAsync(retryDelayMs)
      expect(removeHostTreeMock).toHaveBeenCalledTimes(index + 2)
    }

    // Bounded: a permanently wedged tree stops burning timers and waits for the next startup drain.
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(removeHostTreeMock).toHaveBeenCalledTimes(
      HISTORY_TREE_REMOVAL_RETRY_DELAYS_MS.length + 1
    )
    expect(removeHostTreeMock).toHaveBeenLastCalledWith(expect.stringContaining('.pending-delete'))
  })

  it('does not re-arm a retry after the removal succeeds', async () => {
    seedWorktreeHistory('repo-1::/path/clean-wt')

    deleteWorktreeHistoryDir('repo-1::/path/clean-wt')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(HISTORY_TREE_REMOVAL_RETRY_DELAYS_MS[0])

    expect(removeHostTreeMock).toHaveBeenCalledTimes(1)
  })

  it('admits a bounded tombstone batch and drains the rest from disk', async () => {
    const distroRoot = join(userDataDir, 'terminal-history-wsl', 'Ubuntu')
    mkdirSync(distroRoot, { recursive: true })
    const releases: (() => void)[] = []
    removeHostTreeMock.mockImplementation(
      (dir) =>
        new Promise<void>((resolve) =>
          releases.push(() => {
            rmSync(dir, { recursive: true, force: true })
            resolve()
          })
        )
    )

    for (let index = 0; index < 1_000; index++) {
      const worktreeId = `repo-1::/path/wsl-${index}`
      const dir = join(distroRoot, hashWorktreeId(worktreeId))
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'meta.json'),
        JSON.stringify({
          worktreeId,
          fishSession: fishHistorySessionName(hashWorktreeId(worktreeId))
        })
      )
    }

    for (let index = 0; index < 1_000; index++) {
      deleteWorktreeHistoryDir(`repo-1::/path/wsl-${index}`)
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(removeHostTreeMock).toHaveBeenCalledTimes(64)
    expect(deleteWslFishHistoryFileMock).toHaveBeenCalledTimes(64)
    expect(releases).toHaveLength(64)

    while (releases.length > 0) {
      releases.splice(0).forEach((release) => release())
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(removeHostTreeMock).toHaveBeenCalledTimes(1_000)
    expect(deleteWslFishHistoryFileMock).toHaveBeenCalledTimes(1_000)
  })

  it('caps persistent failures and leaves excess tombstones for a later disk batch', async () => {
    const distroRoot = join(userDataDir, 'terminal-history-wsl', 'Ubuntu')
    mkdirSync(distroRoot, { recursive: true })
    deleteWslFishHistoryFileMock.mockRejectedValue(new Error('wsl unavailable'))
    for (let index = 0; index < 1_000; index++) {
      const worktreeId = `repo-1::/path/fail-${index}`
      const dir = join(distroRoot, hashWorktreeId(worktreeId))
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'meta.json'),
        JSON.stringify({
          worktreeId,
          fishSession: fishHistorySessionName(hashWorktreeId(worktreeId))
        })
      )
      deleteWorktreeHistoryDir(worktreeId)
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(removeHostTreeMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(64)
    expect(readdirSync(join(distroRoot, '.pending-delete'))).toHaveLength(1_000)

    for (const delay of HISTORY_TREE_REMOVAL_RETRY_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delay)
      expect(vi.getTimerCount()).toBeLessThanOrEqual(64)
    }
    await vi.advanceTimersByTimeAsync(0)
    deleteWslFishHistoryFileMock.mockResolvedValue(undefined)
    removeHostTreeMock.mockImplementation(async (dir) => {
      rmSync(dir, { recursive: true, force: true })
    })
    schedulePendingHistoryTreeRemovals(distroRoot)
    await flushPendingWorktreeHistoryDeletions()
    expect(removeHostTreeMock.mock.calls.length).toBeGreaterThan(
      MAX_PENDING_HISTORY_TREE_REMOVALS * (HISTORY_TREE_REMOVAL_RETRY_DELAYS_MS.length + 1)
    )
    expect(readdirSync(join(distroRoot, '.pending-delete'))).toHaveLength(0)
  })
})
