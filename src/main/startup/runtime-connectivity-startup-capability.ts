import { registerMobileHandlers } from '../ipc/mobile'
import { callRuntimeEnvironment } from '../ipc/runtime-environment-transport-routing'
import { loadAgentSessionClaimSigner } from '../runtime/agent-session-claim-identity'
import { fingerprintOrchestrationPeer } from '../runtime/orchestration/environment-transport'
import { resolveAdvertisedPairingEndpoint } from '../runtime/pairing-endpoint'
import { resolveEnvironment } from '../../shared/runtime-environment-store'
import { getPreferredPairingOffer } from '../../shared/runtime-environments'

export type RuntimeConnectivityStartupCapability = {
  callRuntimeEnvironment: typeof callRuntimeEnvironment
  fingerprintOrchestrationPeer: typeof fingerprintOrchestrationPeer
  getPreferredPairingOffer: typeof getPreferredPairingOffer
  loadAgentSessionClaimSigner: typeof loadAgentSessionClaimSigner
  registerMobileHandlers: typeof registerMobileHandlers
  resolveAdvertisedPairingEndpoint: typeof resolveAdvertisedPairingEndpoint
  resolveEnvironment: typeof resolveEnvironment
}

export function createRuntimeConnectivityStartupCapability(): RuntimeConnectivityStartupCapability {
  return {
    callRuntimeEnvironment,
    fingerprintOrchestrationPeer,
    getPreferredPairingOffer,
    loadAgentSessionClaimSigner,
    registerMobileHandlers,
    resolveAdvertisedPairingEndpoint,
    resolveEnvironment
  }
}
