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
 * tombstones, and the async rm finishes afterwards.
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
    // Enough files that a recursive sync walk would dominate the critical-path duration.
    for (let i = 0; i < 3_000; i++) {
      writeFileSync(join(historyDir, `file-${i}.txt`), `payload-${i}`)
    }

    // Why critical-path wall time, not setInterval gaps: deleteWorktreeHistoryDir is sync and must
    // only rename. Interval gaps during the later async rm spike under CI scheduling (~50ms) even
    // when the critical path is fine; a recursive sync walk of 3k files is still hundreds of ms.
    const criticalPathStartedAt = performance.now()
    deleteWorktreeHistoryDir(worktreeId)
    const criticalPathMs = performance.now() - criticalPathStartedAt

    expect(criticalPathMs).toBeLessThan(100)
    expect(readdirSync(join(userDataDir, 'terminal-history'))).not.toContain(hash)
    expect(
      readdirSync(join(userDataDir, 'terminal-history', '.pending-delete')).length
    ).toBeGreaterThan(0)

    await flushPendingWorktreeHistoryDeletions()
    expect(readdirSync(join(userDataDir, 'terminal-history', '.pending-delete'))).toHaveLength(0)
  })
})
