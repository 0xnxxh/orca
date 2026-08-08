import {
  PTY_CONSUMER_SESSION_PROTOCOL_VERSION,
  type PtyConsumerSessionGrant
} from '../../shared/pty-consumer-session'
import { PTY_EXACT_OPERATION_PROTOCOL_VERSION } from '../../shared/pty-exact-operation-protocol'
import { TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION } from '../../shared/terminal-authority-exact-operation-protocol'
import { TERMINAL_AUTHORITY_OUTCOME_DELIVERY_VERSION } from '../../shared/terminal-authority-outcome-delivery'
import {
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
  sameTerminalAuthorityPolicyConsumer
} from '../../shared/terminal-session-authority-consumer-transport'
import { TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION } from '../../shared/terminal-session-authority-consumer-proof'
import { TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION } from '../../shared/terminal-session-authority-consumer-retirement'
import { assertAuthorityId } from '../../shared/terminal-session-authority-identity'
import { terminalAuthorityTopologyGrantFromPtyCapabilities } from '../../shared/terminal-authority-topology-stream-contract'
import type { OpenSshPtyConsumerSessionOptions } from './ssh-pty-consumer-session-types'

export function validateSshPtyConsumerSessionGrant(
  value: unknown,
  options: OpenSshPtyConsumerSessionOptions
): PtyConsumerSessionGrant {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Remote relay returned an invalid pty.openClient grant')
  }
  if (!options.expectedServerBuildId) {
    throw new Error('Local relay build identity is unavailable')
  }
  const grant = value as Partial<PtyConsumerSessionGrant>
  if (
    grant.protocolVersion !== PTY_CONSUMER_SESSION_PROTOCOL_VERSION ||
    grant.serverBuildId !== options.expectedServerBuildId
  ) {
    throw new Error(
      `Remote relay session contract mismatch — expected build ${options.expectedServerBuildId}, got ${grant.serverBuildId ?? 'unknown'}`
    )
  }
  if (
    !Number.isSafeInteger(grant.clientGeneration) ||
    grant.clientGeneration! <= 0 ||
    grant.role !== 'session-owner' ||
    !Number.isSafeInteger(grant.ownerGeneration) ||
    grant.ownerGeneration! <= 0 ||
    typeof grant.ownerLease !== 'string' ||
    grant.ownerLease.length === 0 ||
    grant.ownerLease.length > 512
  ) {
    throw new Error('Remote relay did not grant an authenticated PTY session owner')
  }
  // Client and relay share a build; a missing `resumed` is corruption, not an older peer.
  if (typeof grant.resumed !== 'boolean') {
    throw new Error('Remote relay owner grant did not state whether the claim was resumed')
  }
  const requestedFlow = options.outputFlowControl
  const grantedFlow = grant.capabilities?.outputFlowControl
  if (requestedFlow) {
    if (
      grantedFlow?.version !== 1 ||
      !Number.isSafeInteger(grantedFlow.windowSu) ||
      grantedFlow.windowSu <= 0 ||
      grantedFlow.windowSu > requestedFlow.requestedWindowSu
    ) {
      throw new Error('Remote relay did not grant the offered PTY output-flow-control capability')
    }
  } else if (grantedFlow) {
    throw new Error('Remote relay granted an unoffered PTY output-flow-control capability')
  }
  const grantedExact = grant.capabilities?.exactOperations
  if (options.exactOperations) {
    if (grantedExact?.version !== PTY_EXACT_OPERATION_PROTOCOL_VERSION) {
      throw new Error('Remote relay did not grant the offered PTY exact-operation capability')
    }
  } else if (grantedExact) {
    throw new Error('Remote relay granted an invalid or unoffered PTY exact-operation capability')
  }
  const grantedHeldPause = grant.capabilities?.heldProducerPause
  if (grantedHeldPause && (!options.heldProducerPause || grantedHeldPause.version !== 1)) {
    throw new Error('Remote relay granted an invalid or unoffered held-producer-pause capability')
  }
  const grantedAuthorityExact = grant.capabilities?.terminalAuthorityExactOperations
  if (options.terminalAuthorityExactOperations) {
    if (grantedAuthorityExact?.version !== TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION) {
      throw new Error('Remote relay did not grant terminal authority exact operations')
    }
  } else if (grantedAuthorityExact) {
    throw new Error('Remote relay granted unoffered terminal authority exact operations')
  }
  const grantedAuthorityOutcome = grant.capabilities?.terminalAuthorityOutcomeDelivery
  if (options.terminalAuthorityOutcomeDelivery) {
    if (grantedAuthorityOutcome?.version !== TERMINAL_AUTHORITY_OUTCOME_DELIVERY_VERSION) {
      throw new Error('Remote relay did not grant terminal authority outcome delivery')
    }
  } else if (grantedAuthorityOutcome) {
    throw new Error('Remote relay granted unoffered terminal authority outcome delivery')
  }
  const namespaceOutcomeClaim = options.terminalAuthorityNamespaceOutcomeClaim
  const grantedNamespaceOutcomes = grant.capabilities?.terminalAuthorityNamespaceOutcomes
  if (namespaceOutcomeClaim) {
    if (
      grantedNamespaceOutcomes?.version !== TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION ||
      !sameTerminalAuthorityPolicyConsumer(
        grantedNamespaceOutcomes.consumer,
        namespaceOutcomeClaim.consumer
      )
    ) {
      throw new Error('Remote relay did not grant terminal authority namespace outcomes')
    }
  } else if (grantedNamespaceOutcomes) {
    throw new Error('Remote relay granted unoffered terminal authority namespace outcomes')
  }
  const grantedConsumerProof = grant.capabilities?.terminalAuthorityConsumerProof
  if (grantedConsumerProof) {
    if (!options.terminalAuthorityConsumerProof) {
      throw new Error('Remote relay granted unoffered terminal authority consumer proof')
    }
    try {
      assertAuthorityId(grantedConsumerProof.authorityHostId, 'remote authorityHostId')
    } catch {
      throw new Error('Remote relay granted invalid terminal authority consumer proof')
    }
    if (grantedConsumerProof.version !== TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION) {
      throw new Error('Remote relay granted invalid terminal authority consumer proof')
    }
    if (
      options.requiredTerminalAuthorityConsumerProofHostId &&
      grantedConsumerProof.authorityHostId !== options.requiredTerminalAuthorityConsumerProofHostId
    ) {
      throw new Error('Remote relay granted terminal authority proof for another host')
    }
  } else if (options.requiredTerminalAuthorityConsumerProofHostId) {
    throw new Error('Remote relay did not grant mandatory terminal authority consumer proof')
  }
  if (options.terminalAuthorityConsumerRetirement) {
    if (
      !options.terminalAuthorityConsumerProof ||
      grantedConsumerProof?.retirementVersion !== TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION
    ) {
      throw new Error('Remote relay did not grant terminal authority consumer retirement')
    }
  } else if (grantedConsumerProof?.retirementVersion !== undefined) {
    throw new Error('Remote relay granted unoffered terminal authority consumer retirement')
  }
  const rawTopology = grant.capabilities?.terminalAuthorityTopology
  const grantedTopology = terminalAuthorityTopologyGrantFromPtyCapabilities(grant.capabilities)
  if (rawTopology !== undefined && (!options.terminalAuthorityTopology || !grantedTopology)) {
    throw new Error('Remote relay granted an invalid or unoffered terminal topology capability')
  }
  return grant as PtyConsumerSessionGrant
}
