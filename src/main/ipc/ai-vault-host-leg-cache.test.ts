import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultListResult } from '../../shared/ai-vault-types'
import {
  AI_VAULT_HOST_LEG_CACHE_MAX_ENTRIES,
  resetAiVaultHostLegCacheForTests,
  scanHostLegWithCache
} from './ai-vault-host-leg-cache'

const RESULT: AiVaultListResult = {
  sessions: [],
  issues: [],
  scannedAt: '2026-08-14T00:00:00.000Z'
}

beforeEach(() => {
  resetAiVaultHostLegCacheForTests()
})

describe('AI Vault host-leg cache', () => {
  it('deduplicates concurrent non-force scans for the same host and depth', async () => {
    let resolveScan!: (result: AiVaultListResult) => void
    const scan = vi.fn(
      () =>
        new Promise<AiVaultListResult>((resolve) => {
          resolveScan = resolve
        })
    )
    const args = { cacheKey: 'host-a', depth: 500 as const, force: false, scan }

    const first = scanHostLegWithCache(args)
    const second = scanHostLegWithCache(args)
    expect(scan).toHaveBeenCalledTimes(1)
    resolveScan(RESULT)

    await expect(Promise.all([first, second])).resolves.toEqual([RESULT, RESULT])
  })

  it('evicts an earlier healthy result when a forced refresh returns a host issue', async () => {
    const hostFailure: AiVaultListResult = {
      ...RESULT,
      issues: [
        {
          executionHostId: 'ssh:host-a',
          agent: 'codex',
          kind: 'host',
          path: 'host-a',
          message: 'offline'
        }
      ]
    }
    const scan = vi
      .fn()
      .mockResolvedValue(RESULT)
      .mockResolvedValueOnce(RESULT)
      .mockResolvedValueOnce(hostFailure)
    const baseArgs = { cacheKey: 'host-a', depth: 500 as const, scan }

    await scanHostLegWithCache({ ...baseArgs, force: false })
    await scanHostLegWithCache({ ...baseArgs, force: true })
    await scanHostLegWithCache({ ...baseArgs, force: false })

    expect(scan).toHaveBeenCalledTimes(3)
  })

  it('caps retained host legs', async () => {
    const scan = vi.fn().mockResolvedValue(RESULT)
    for (let index = 0; index <= AI_VAULT_HOST_LEG_CACHE_MAX_ENTRIES; index++) {
      await scanHostLegWithCache({
        cacheKey: `host-${index}`,
        depth: 500,
        force: false,
        scan
      })
    }

    await scanHostLegWithCache({ cacheKey: 'host-0', depth: 500, force: false, scan })

    expect(scan).toHaveBeenCalledTimes(AI_VAULT_HOST_LEG_CACHE_MAX_ENTRIES + 2)
  })
})
