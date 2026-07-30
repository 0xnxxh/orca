import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('account-runtime coordination startup owner', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('fails closed before installation', async () => {
    const { getAccountRuntimeCoordinationStartupCapability } =
      await import('./account-runtime-coordination-startup-owner')

    expect(() => getAccountRuntimeCoordinationStartupCapability()).toThrow(
      'Account-runtime coordination capability must be initialized before use'
    )
  })

  it('returns the exact installed capability identity', async () => {
    const {
      getAccountRuntimeCoordinationStartupCapability,
      installAccountRuntimeCoordinationStartupCapability
    } = await import('./account-runtime-coordination-startup-owner')
    const capability = {
      attachClaudeLivePtyPersistence: vi.fn(),
      createAccountRuntimeTargetSettingsSync: vi.fn(),
      getInitialClaudeRateLimitTarget: vi.fn(),
      getInitialCodexRateLimitTarget: vi.fn(),
      normalizeClaudeRuntimeSelection: vi.fn(),
      onLiveClaudePtysDrained: vi.fn(),
      readMiniMaxSessionCookie: vi.fn(),
      seedLiveClaudePtysFromPersistence: vi.fn()
    }

    installAccountRuntimeCoordinationStartupCapability(capability as never)

    expect(getAccountRuntimeCoordinationStartupCapability()).toBe(capability)
  })
})
