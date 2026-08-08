// Why: specs that drive the real consumer session over a fake relay must answer pty.openClient the
// way a current relay does — echoing exactly the offered capabilities, no more and no less.
import { PTY_EXACT_OPERATION_PROTOCOL_VERSION } from '../../shared/pty-exact-operation-protocol'
import { TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION } from '../../shared/terminal-authority-exact-operation-protocol'
import { TERMINAL_AUTHORITY_OUTCOME_DELIVERY_VERSION } from '../../shared/terminal-authority-outcome-delivery'
import { TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION } from '../../shared/terminal-session-authority-consumer-transport'
import { TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION } from '../../shared/terminal-session-authority-consumer-proof'
import { TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION } from '../../shared/terminal-session-authority-consumer-retirement'
import {
  TERMINAL_AUTHORITY_TOPOLOGY_PTY_CAPABILITY,
  TERMINAL_AUTHORITY_TOPOLOGY_STREAM_VERSION
} from '../../shared/terminal-authority-topology-stream-contract'

type Offer = Record<string, unknown> | undefined

function offered(capabilities: Offer, name: string): Record<string, unknown> | undefined {
  const value = capabilities?.[name]
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Build the grant a current relay returns for `params`. `authorityHostId` must match the deploy
 * result the session admitted, and `withheld` models an owner that never negotiated a capability.
 */
export function sshPtyOpenClientGrant(
  params: Record<string, unknown>,
  options: Readonly<{
    serverBuildId: string
    authorityHostId: string
    withheld?: readonly string[]
  }>
): Record<string, unknown> {
  const capabilities = offered(params, 'capabilities')
  const resume = offered(params, 'resume')
  const withheld = new Set(options.withheld ?? [])
  const grantFor = (name: string): Record<string, unknown> | undefined =>
    withheld.has(name) ? undefined : offered(capabilities, name)

  const outputFlowControl = grantFor('outputFlowControl')
  const namespaceOutcomes = grantFor('terminalAuthorityNamespaceOutcomes')
  const consumerProof = grantFor('terminalAuthorityConsumerProof')
  const granted = {
    ...(outputFlowControl
      ? {
          outputFlowControl: { version: 1, windowSu: Number(outputFlowControl.requestedWindowSu) }
        }
      : {}),
    ...(grantFor('exactOperations')
      ? { exactOperations: { version: PTY_EXACT_OPERATION_PROTOCOL_VERSION } }
      : {}),
    ...(grantFor('heldProducerPause') ? { heldProducerPause: { version: 1 } } : {}),
    ...(grantFor('terminalAuthorityExactOperations')
      ? {
          terminalAuthorityExactOperations: { version: TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION }
        }
      : {}),
    ...(grantFor('terminalAuthorityOutcomeDelivery')
      ? {
          terminalAuthorityOutcomeDelivery: { version: TERMINAL_AUTHORITY_OUTCOME_DELIVERY_VERSION }
        }
      : {}),
    ...(namespaceOutcomes
      ? {
          terminalAuthorityNamespaceOutcomes: {
            version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
            consumer: namespaceOutcomes.consumer
          }
        }
      : {}),
    ...(consumerProof
      ? {
          terminalAuthorityConsumerProof: {
            version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
            authorityHostId: options.authorityHostId,
            ...(consumerProof.retirementVersions
              ? { retirementVersion: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION }
              : {})
          }
        }
      : {}),
    ...(grantFor(TERMINAL_AUTHORITY_TOPOLOGY_PTY_CAPABILITY)
      ? {
          [TERMINAL_AUTHORITY_TOPOLOGY_PTY_CAPABILITY]: {
            version: TERMINAL_AUTHORITY_TOPOLOGY_STREAM_VERSION
          }
        }
      : {})
  }

  return {
    protocolVersion: Number(params.protocolVersion),
    serverBuildId: options.serverBuildId,
    clientGeneration: 1,
    role: 'session-owner',
    ownerGeneration: resume ? Number(resume.ownerGeneration) + 1 : 1,
    ownerLease: 'test-owner-lease',
    resumed: resume !== undefined,
    ...(Object.keys(granted).length > 0 ? { capabilities: granted } : {})
  }
}
