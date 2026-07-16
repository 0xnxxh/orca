import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { ghExecFileAsyncMock } = vi.hoisted(() => ({
  ghExecFileAsyncMock: vi.fn()
}))

vi.mock('../git/runner', () => ({
  ghExecFileAsync: ghExecFileAsyncMock
}))

vi.mock('./gh-utils', () => ({
  acquire: vi.fn(),
  release: vi.fn()
}))

import {
  getRateLimit,
  rateLimitGuard,
  noteRateLimitSpend,
  spendsSharedGitHubComQuota,
  repositoryRateLimitGuard,
  noteRepositoryRateLimitSpend,
  _resetRateLimitCache
} from './rate-limit'

const PAYLOAD = JSON.stringify({
  resources: {
    core: { limit: 5000, remaining: 4200, reset: 1_700_000_000 },
    search: { limit: 30, remaining: 28, reset: 1_700_000_000 },
    graphql: { limit: 5000, remaining: 4900, reset: 1_700_000_000 }
  }
})

describe('getRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    ghExecFileAsyncMock.mockReset()
    _resetRateLimitCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('parses bucket counts from gh api rate_limit', async () => {
    ghExecFileAsyncMock.mockResolvedValue({ stdout: PAYLOAD })

    const result = await getRateLimit()

    expect(result).toEqual({
      ok: true,
      snapshot: {
        core: { limit: 5000, remaining: 4200, resetAt: 1_700_000_000 },
        search: { limit: 30, remaining: 28, resetAt: 1_700_000_000 },
        graphql: { limit: 5000, remaining: 4900, resetAt: 1_700_000_000 },
        fetchedAt: 1_000
      }
    })
    // The runner injects --hostname at spawn from the `host` option, so the
    // probe passes bare argv and pins the host to github.com through options.
    expect(ghExecFileAsyncMock).toHaveBeenCalledWith(['api', 'rate_limit'], {
      encoding: 'utf-8',
      host: 'github.com'
    })
  })

  it('caches a failed probe for the TTL instead of re-spawning gh', async () => {
    // Why: refreshes fail open past a probe failure, so without a negative cache
    // an auth or transport failure would spawn the same doomed gh call repeatedly.
    ghExecFileAsyncMock.mockRejectedValue(new Error('HTTP 404: Rate limiting is not enabled.'))

    const first = await getRateLimit()
    const second = await getRateLimit()

    expect(first).toEqual({ ok: false, error: 'HTTP 404: Rate limiting is not enabled.' })
    expect(second).toEqual(first)
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('re-probes after the failure TTL elapses and recovers on success', async () => {
    ghExecFileAsyncMock.mockRejectedValueOnce(new Error('boom'))
    ghExecFileAsyncMock.mockResolvedValue({ stdout: PAYLOAD })

    expect((await getRateLimit()).ok).toBe(false)
    expect((await getRateLimit()).ok).toBe(false)
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(1_000 + 30_000)

    expect((await getRateLimit()).ok).toBe(true)
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(2)
  })

  it('bypasses the failure cache when forced', async () => {
    ghExecFileAsyncMock.mockRejectedValueOnce(new Error('boom'))
    ghExecFileAsyncMock.mockResolvedValue({ stdout: PAYLOAD })

    expect((await getRateLimit()).ok).toBe(false)
    expect((await getRateLimit({ force: true })).ok).toBe(true)
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(2)
  })
})

describe('rateLimitGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    ghExecFileAsyncMock.mockReset()
    _resetRateLimitCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function cacheExhaustedSnapshot(resetEpochSeconds: number): Promise<void> {
    ghExecFileAsyncMock.mockResolvedValueOnce({
      stdout: JSON.stringify({
        resources: {
          core: { limit: 5000, remaining: 3, reset: resetEpochSeconds },
          search: { limit: 30, remaining: 28, reset: resetEpochSeconds },
          graphql: { limit: 5000, remaining: 4900, reset: resetEpochSeconds }
        }
      })
    })
    expect((await getRateLimit()).ok).toBe(true)
  }

  it('blocks below the floor while resetAt is in the future', async () => {
    await cacheExhaustedSnapshot(61)

    expect(rateLimitGuard('core')).toEqual({
      blocked: true,
      remaining: 3,
      limit: 5000,
      resetAt: 61
    })
  })

  it('fails open once the blocking bucket resetAt has elapsed', async () => {
    // Why: probes can fail indefinitely (sleep past resetAt, network blip), so
    // a stale exhausted snapshot must not block once GitHub has already reset
    // the budget — a past-due pause would spin the coordinator drain loop.
    await cacheExhaustedSnapshot(61)

    vi.setSystemTime(61_000)

    expect(rateLimitGuard('core')).toEqual({ blocked: false })
  })
})

// Why: only default github.com traffic on the native runtime shares this
// snapshot's budget. GHES hosts and WSL distros run against separate quotas,
// so the shared guard must bypass them entirely.
describe('shared-quota host scoping', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    ghExecFileAsyncMock.mockReset()
    _resetRateLimitCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function cacheExhaustedSnapshot(resetEpochSeconds: number): Promise<void> {
    ghExecFileAsyncMock.mockResolvedValueOnce({
      stdout: JSON.stringify({
        resources: {
          core: { limit: 5000, remaining: 3, reset: resetEpochSeconds },
          search: { limit: 30, remaining: 28, reset: resetEpochSeconds },
          graphql: { limit: 5000, remaining: 4900, reset: resetEpochSeconds }
        }
      })
    })
    expect((await getRateLimit()).ok).toBe(true)
  }

  it('treats github.com / no host on the native runtime as sharing the budget', () => {
    expect(spendsSharedGitHubComQuota(undefined)).toBe(true)
    expect(spendsSharedGitHubComQuota(null)).toBe(true)
    expect(spendsSharedGitHubComQuota({ host: 'github.com' })).toBe(true)
    expect(spendsSharedGitHubComQuota({ host: 'GitHub.com' })).toBe(true)
  })

  it('excludes GHES hosts and WSL runtimes from the shared budget', () => {
    expect(spendsSharedGitHubComQuota({ host: 'github.acme-corp.com' })).toBe(false)
    expect(spendsSharedGitHubComQuota({ host: 'github.com' }, { wslDistro: 'Ubuntu' })).toBe(false)
    expect(spendsSharedGitHubComQuota(undefined, { wslDistro: 'Ubuntu' })).toBe(false)
  })

  it('applies the shared guard for github.com but bypasses non-shared scopes', async () => {
    await cacheExhaustedSnapshot(61)

    expect(repositoryRateLimitGuard({ host: 'github.com' }, 'core')).toEqual({
      blocked: true,
      remaining: 3,
      limit: 5000,
      resetAt: 61
    })
    expect(repositoryRateLimitGuard({ host: 'github.acme-corp.com' }, 'core')).toEqual({
      blocked: false
    })
    expect(
      repositoryRateLimitGuard({ host: 'github.com' }, 'core', { wslDistro: 'Ubuntu' })
    ).toEqual({ blocked: false })
  })

  it('debits shared-budget spend but no-ops for non-shared scopes', async () => {
    await cacheExhaustedSnapshot(61)

    noteRepositoryRateLimitSpend({ host: 'github.acme-corp.com' }, 'core')
    const afterEnterprise = rateLimitGuard('core')
    expect(afterEnterprise.blocked && afterEnterprise.remaining).toBe(3)

    noteRepositoryRateLimitSpend({ host: 'github.com' }, 'core')
    const afterShared = rateLimitGuard('core')
    expect(afterShared.blocked && afterShared.remaining).toBe(2)
  })

  it('matches noteRateLimitSpend when the scope is shared github.com', async () => {
    await cacheExhaustedSnapshot(61)
    noteRateLimitSpend('core')
    const guard = rateLimitGuard('core')
    expect(guard.blocked && guard.remaining).toBe(2)
  })
})
