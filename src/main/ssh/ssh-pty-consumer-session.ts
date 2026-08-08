import { PTY_CONSUMER_SESSION_PROTOCOL_VERSION } from '../../shared/pty-consumer-session'
import { PTY_EXACT_OPERATION_PROTOCOL_VERSION } from '../../shared/pty-exact-operation-protocol'
import { TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION } from '../../shared/terminal-authority-exact-operation-protocol'
import { TERMINAL_AUTHORITY_OUTCOME_DELIVERY_VERSION } from '../../shared/terminal-authority-outcome-delivery'
import { TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION } from '../../shared/terminal-session-authority-consumer-transport'
import { TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION } from '../../shared/terminal-session-authority-consumer-proof'
import { TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION } from '../../shared/terminal-session-authority-consumer-retirement'
import {
  TERMINAL_AUTHORITY_TOPOLOGY_STREAM_VERSION,
  terminalAuthorityTopologyGrantFromPtyCapabilities
} from '../../shared/terminal-authority-topology-stream-contract'
import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import { validateSshPtyConsumerSessionGrant } from './ssh-pty-consumer-session-grant-validation'
import type {
  OpenSshPtyConsumerSessionOptions,
  SshPtyConsumerAdmission
} from './ssh-pty-consumer-session-types'

export type {
  OpenSshPtyConsumerSessionOptions,
  SshPtyConsumerAdmission,
  SshPtyConsumerOwnerState,
  SshPtyConsumerSessionState,
  SshPtyLegacyFallbackState
} from './ssh-pty-consumer-session-types'

export const SSH_PTY_OPEN_CLIENT_METHOD = 'pty.openClient'
export const SSH_PTY_OPEN_CLIENT_TIMEOUT_MS = 10_000

export async function openSshPtyConsumerSession(
  mux: SshChannelMultiplexer,
  options: OpenSshPtyConsumerSessionOptions
): Promise<SshPtyConsumerAdmission> {
  let result: unknown
  try {
    result = await mux.request(
      SSH_PTY_OPEN_CLIENT_METHOD,
      {
        protocolVersion: PTY_CONSUMER_SESSION_PROTOCOL_VERSION,
        clientInstanceId: options.clientInstanceId,
        requestedRole: 'session-owner',
        ...(options.resume ? { resume: options.resume } : {}),
        ...(options.outputFlowControl ||
        options.exactOperations ||
        options.heldProducerPause ||
        options.terminalAuthorityExactOperations ||
        options.terminalAuthorityOutcomeDelivery ||
        options.terminalAuthorityNamespaceOutcomeClaim ||
        options.terminalAuthorityConsumerProof ||
        options.terminalAuthorityTopology
          ? {
              capabilities: {
                ...(options.outputFlowControl
                  ? {
                      outputFlowControl: {
                        versions: [1],
                        requestedWindowSu: options.outputFlowControl.requestedWindowSu
                      }
                    }
                  : {}),
                ...(options.exactOperations
                  ? { exactOperations: { versions: [PTY_EXACT_OPERATION_PROTOCOL_VERSION] } }
                  : {}),
                ...(options.heldProducerPause ? { heldProducerPause: { versions: [1] } } : {}),
                ...(options.terminalAuthorityExactOperations
                  ? {
                      terminalAuthorityExactOperations: {
                        versions: [TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION]
                      }
                    }
                  : {}),
                ...(options.terminalAuthorityOutcomeDelivery
                  ? {
                      terminalAuthorityOutcomeDelivery: {
                        versions: [TERMINAL_AUTHORITY_OUTCOME_DELIVERY_VERSION]
                      }
                    }
                  : {}),
                ...(options.terminalAuthorityNamespaceOutcomeClaim
                  ? {
                      terminalAuthorityNamespaceOutcomes: {
                        versions: [TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION],
                        consumer: options.terminalAuthorityNamespaceOutcomeClaim.consumer,
                        expectedConsumerIncarnationId:
                          options.terminalAuthorityNamespaceOutcomeClaim
                            .expectedConsumerIncarnationId
                      }
                    }
                  : {}),
                ...(options.terminalAuthorityConsumerProof
                  ? {
                      terminalAuthorityConsumerProof: {
                        versions: [TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION],
                        ...(options.terminalAuthorityConsumerRetirement
                          ? {
                              retirementVersions: [TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION]
                            }
                          : {})
                      }
                    }
                  : {}),
                ...(options.terminalAuthorityTopology
                  ? {
                      terminalAuthorityTopology: {
                        versions: [TERMINAL_AUTHORITY_TOPOLOGY_STREAM_VERSION]
                      }
                    }
                  : {})
              }
            }
          : {})
      },
      { timeoutMs: SSH_PTY_OPEN_CLIENT_TIMEOUT_MS }
    )
  } catch (error) {
    const code = (error as { code?: unknown })?.code
    if (
      code === -32601 &&
      options.allowSameBuildLegacyFallback === true &&
      options.requiredTerminalAuthorityConsumerProofHostId === undefined &&
      typeof options.expectedServerBuildId === 'string' &&
      options.expectedServerBuildId.length > 0
    ) {
      return {
        state: Object.freeze({
          mode: 'legacy-fallback',
          clientInstanceId: options.clientInstanceId,
          serverBuildId: options.expectedServerBuildId
        }),
        resumed: false
      }
    }
    throw error
  }
  const grant = validateSshPtyConsumerSessionGrant(result, options)
  return {
    state: {
      mode: 'negotiated',
      clientInstanceId: options.clientInstanceId,
      clientGeneration: grant.clientGeneration,
      ownerGeneration: grant.ownerGeneration!,
      ownerLease: grant.ownerLease!,
      ...(grant.capabilities?.outputFlowControl
        ? { outputFlowControl: grant.capabilities.outputFlowControl }
        : {}),
      ...(grant.capabilities?.exactOperations
        ? { exactOperations: grant.capabilities.exactOperations }
        : {}),
      ...(grant.capabilities?.heldProducerPause
        ? { heldProducerPause: grant.capabilities.heldProducerPause }
        : {}),
      ...(grant.capabilities?.terminalAuthorityExactOperations
        ? {
            terminalAuthorityExactOperations: grant.capabilities.terminalAuthorityExactOperations
          }
        : {}),
      ...(grant.capabilities?.terminalAuthorityOutcomeDelivery
        ? {
            terminalAuthorityOutcomeDelivery: grant.capabilities.terminalAuthorityOutcomeDelivery
          }
        : {}),
      ...(grant.capabilities?.terminalAuthorityNamespaceOutcomes
        ? {
            terminalAuthorityNamespaceOutcomes:
              grant.capabilities.terminalAuthorityNamespaceOutcomes
          }
        : {}),
      ...(grant.capabilities?.terminalAuthorityConsumerProof
        ? {
            terminalAuthorityConsumerProof: grant.capabilities.terminalAuthorityConsumerProof
          }
        : {}),
      ...(terminalAuthorityTopologyGrantFromPtyCapabilities(grant.capabilities)
        ? { terminalAuthorityTopology: { version: 1 as const } }
        : {})
    },
    resumed: grant.resumed!
  }
}
