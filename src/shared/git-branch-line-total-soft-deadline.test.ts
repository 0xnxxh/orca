import { describe, expect, it } from 'vitest'
import {
  beginGitStatusLineStatsCacheWrite,
  clearGitStatusLineStatsCache,
  reuseOrRecomputeGitStatusLineStats
} from './git-status-line-stats-cache'

const MERGE_BASE = 'a'.repeat(40)
const entries = [{ path: 'a.txt', area: 'unstaged', status: 'M', added: 1, removed: 0 }]

async function runPass(diffDelayMs: number): Promise<{ elapsed: number; total: unknown }> {
  const cacheKey = 'native\0/repo'
  const started = Date.now()
  const result = await reuseOrRecomputeGitStatusLineStats({
    cacheKey,
    head: 'head-1',
    entries,
    writeToken: beginGitStatusLineStatsCacheWrite(cacheKey),
    reuse: false,
    isAborted: () => false,
    recompute: async () => true,
    branchLineTotal: {
      mergeBase: MERGE_BASE,
      compute: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ added: 5, removed: 5, mergeBase: MERGE_BASE }), diffDelayMs)
        )
    }
  })
  return { elapsed: Date.now() - started, total: result.branchLineTotal }
}

describe('branch line total never blocks the status response', () => {
  it('returns fast when the ranged diff is slow, then publishes it on the next pass', async () => {
    clearGitStatusLineStatsCache()
    const slow = await runPass(3000)
    expect(slow.total).toBeUndefined()
    expect(slow.elapsed).toBeLessThan(1200)

    await new Promise((r) => setTimeout(r, 3200))
    const next = await runPass(3000)
    expect(next.total).toEqual({ added: 5, removed: 5, mergeBase: MERGE_BASE })
  }, 20000)

  it('still returns the total inline when the diff is fast', async () => {
    clearGitStatusLineStatsCache()
    const fast = await runPass(10)
    expect(fast.total).toEqual({ added: 5, removed: 5, mergeBase: MERGE_BASE })
    expect(fast.elapsed).toBeLessThan(400)
  })
})
