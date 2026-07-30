import { describe, expect, it, vi } from 'vitest'

const connectivityMocks = vi.hoisted(() => ({
  callRuntimeEnvironment: vi.fn(),
  fingerprintOrchestrationPeer: vi.fn(),
  getPreferredPairingOffer: vi.fn(),
  loadAgentSessionClaimSigner: vi.fn(),
  registerMobileHandlers: vi.fn(),
  resolveAdvertisedPairingEndpoint: vi.fn(),
  resolveEnvironment: vi.fn()
}))

vi.mock('../ipc/mobile', () => ({
  registerMobileHandlers: connectivityMocks.registerMobileHandlers
}))
vi.mock('../ipc/runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment: connectivityMocks.callRuntimeEnvironment
}))
vi.mock('../runtime/agent-session-claim-identity', () => ({
  loadAgentSessionClaimSigner: connectivityMocks.loadAgentSessionClaimSigner
}))
vi.mock('../runtime/orchestration/environment-transport', () => ({
  fingerprintOrchestrationPeer: connectivityMocks.fingerprintOrchestrationPeer
}))
vi.mock('../runtime/pairing-endpoint', () => ({
  resolveAdvertisedPairingEndpoint: connectivityMocks.resolveAdvertisedPairingEndpoint
}))
vi.mock('../../shared/runtime-environment-store', () => ({
  resolveEnvironment: connectivityMocks.resolveEnvironment
}))
vi.mock('../../shared/runtime-environments', () => ({
  getPreferredPairingOffer: connectivityMocks.getPreferredPairingOffer
}))

import { createRuntimeConnectivityStartupCapability } from './runtime-connectivity-startup-capability'

describe('runtime connectivity startup capability', () => {
  it('returns every original function identity', () => {
    expect(createRuntimeConnectivityStartupCapability()).toEqual(connectivityMocks)
  })
})
