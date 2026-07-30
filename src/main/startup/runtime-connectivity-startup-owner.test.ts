import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('runtime connectivity startup owner', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('fails closed before installation', async () => {
    const { getRuntimeConnectivityStartupCapability } =
      await import('./runtime-connectivity-startup-owner')

    expect(() => getRuntimeConnectivityStartupCapability()).toThrow(
      'Runtime connectivity capability must be initialized before use'
    )
  })

  it('returns the exact installed capability identity', async () => {
    const { getRuntimeConnectivityStartupCapability, installRuntimeConnectivityStartupCapability } =
      await import('./runtime-connectivity-startup-owner')
    const capability = {
      callRuntimeEnvironment: vi.fn(),
      fingerprintOrchestrationPeer: vi.fn(),
      getPreferredPairingOffer: vi.fn(),
      loadAgentSessionClaimSigner: vi.fn(),
      registerMobileHandlers: vi.fn(),
      resolveAdvertisedPairingEndpoint: vi.fn(),
      resolveEnvironment: vi.fn()
    }

    installRuntimeConnectivityStartupCapability(capability as never)

    expect(getRuntimeConnectivityStartupCapability()).toBe(capability)
  })
})
