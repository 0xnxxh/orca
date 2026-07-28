import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

import { hashWorktreeId } from './terminal-history-paths'
import {
  deleteWorktreeHistoryDir,
  flushPendingWorktreeHistoryDeletions
} from './terminal-history-deletion'

/**
 * Prove worktree history delete stays off the main-thread recursive-rm path: the critical path only
 * tombstones, the event loop keeps its timers on schedule, and the async rm finishes afterwards.
 */
describe('deleteWorktreeHistoryDir main-thread safety', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'orca-history-async-'))
  })

  afterEach(async () => {
    await flushPendingWorktreeHistoryDeletions()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('tombstones without blocking the event loop, then removes via async rm', async () => {
    const worktreeId = 'repo-1::/path/heavy-wt'
    const hash = hashWorktreeId(worktreeId)
    const historyDir = join(userDataDir, 'terminal-history', hash)
    mkdirSync(historyDir, { recursive: true })
    // Enough files that a recursive sync walk shows up unmistakably in the timer gaps.
    for (let i = 0; i < 3_000; i++) {
      writeFileSync(join(historyDir, `file-${i}.txt`), `payload-${i}`)
    }

    // Why max gap, not wall-clock: the regression to catch is a blocked main thread, and a slow CI
    // box inflates duration without inflating the gap between two timer callbacks.
    let maxGapMs = 0
    let previousTickAt = performance.now()
    const ticker = setInterval(() => {
      const now = performance.now()
      maxGapMs = Math.max(maxGapMs, now - previousTickAt)
      previousTickAt = now
    }, 2)

    try {
      await new Promise((resolve) => setTimeout(resolve, 20))
      previousTickAt = performance.now()
      deleteWorktreeHistoryDir(worktreeId)
      await new Promise((resolve) => setTimeout(resolve, 40))
    } finally {
      clearInterval(ticker)
    }

    expect(maxGapMs).toBeLessThan(30)
    expect(readdirSync(join(userDataDir, 'terminal-history'))).not.toContain(hash)
    expect(
      readdirSync(join(userDataDir, 'terminal-history', '.pending-delete')).length
    ).toBeGreaterThan(0)

    await flushPendingWorktreeHistoryDeletions()
    expect(readdirSync(join(userDataDir, 'terminal-history', '.pending-delete'))).toHaveLength(0)
  })
})
