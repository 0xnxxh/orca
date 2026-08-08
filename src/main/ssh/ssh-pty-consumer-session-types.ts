import type { TerminalAuthorityPolicyConsumerClaim } from '../../shared/terminal-session-authority-consumer-transport'
import type { TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION } from '../../shared/terminal-session-authority-consumer-proof'

export type SshPtyConsumerOwnerState = {
  mode: 'negotiated'
  clientInstanceId: string
  clientGeneration: number
  ownerGeneration: number
  ownerLease: string
  outputFlowControl?: {
    version: 1
    windowSu: number
  }
  exactOperations?: {
    version: 1
  }
  heldProducerPause?: {
    version: 1
  }
  terminalAuthorityExactOperations?: {
    version: 1
  }
  terminalAuthorityOutcomeDelivery?: {
    version: 1
  }
  terminalAuthorityNamespaceOutcomes?: {
    version: 1
    consumer: TerminalAuthorityPolicyConsumerClaim['consumer']
  }
  terminalAuthorityConsumerProof?: {
    version: typeof TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION
    authorityHostId: string
    retirementVersion?: 1
  }
  terminalAuthorityTopology?: {
    version: 1
  }
}

export type SshPtyLegacyFallbackState = {
  mode: 'legacy-fallback'
  clientInstanceId: string
  serverBuildId: string
}

export type SshPtyConsumerSessionState = SshPtyConsumerOwnerState | SshPtyLegacyFallbackState

export type SshPtyConsumerAdmission = {
  state: SshPtyConsumerSessionState
  // Why not on the owner state itself: this describes one admission's outcome, not the persisted
  // claim, and it must never round-trip through the recovery record.
  resumed: boolean
}

export type OpenSshPtyConsumerSessionOptions = {
  clientInstanceId: string
  expectedServerBuildId: string | undefined
  resume?: Pick<SshPtyConsumerOwnerState, 'ownerGeneration' | 'ownerLease'>
  outputFlowControl?: {
    requestedWindowSu: number
  }
  exactOperations?: true
  heldProducerPause?: true
  terminalAuthorityExactOperations?: true
  terminalAuthorityOutcomeDelivery?: true
  terminalAuthorityNamespaceOutcomeClaim?: TerminalAuthorityPolicyConsumerClaim
  terminalAuthorityConsumerProof?: true
  terminalAuthorityConsumerRetirement?: true
  requiredTerminalAuthorityConsumerProofHostId?: string
  terminalAuthorityTopology?: true
  allowSameBuildLegacyFallback?: boolean
}
