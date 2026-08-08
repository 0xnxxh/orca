import type {
  TerminalAuthorityNamespaceBoundaryAcceptance,
  TerminalAuthorityNamespaceOutcomeAck,
  TerminalAuthorityPolicyConsumerRetirement
} from '../../shared/terminal-session-authority-consumer-transport'

export const DAEMON_TERMINAL_AUTHORITY_OUTCOME_ACK_REQUEST =
  'ackTerminalAuthorityNamespaceOutcome' as const
export const DAEMON_TERMINAL_AUTHORITY_BOUNDARY_ACCEPT_REQUEST =
  'acceptTerminalAuthorityNamespaceBoundary' as const

export type AcknowledgeTerminalAuthorityNamespaceOutcomeRequest = Readonly<{
  id: string
  type: typeof DAEMON_TERMINAL_AUTHORITY_OUTCOME_ACK_REQUEST
  payload: TerminalAuthorityNamespaceOutcomeAck
}>

export type AcceptTerminalAuthorityNamespaceBoundaryRequest = Readonly<{
  id: string
  type: typeof DAEMON_TERMINAL_AUTHORITY_BOUNDARY_ACCEPT_REQUEST
  payload: TerminalAuthorityNamespaceBoundaryAcceptance
}>

export type RetireTerminalAuthorityPolicyConsumerRequest = Readonly<{
  id: string
  type: 'retireTerminalAuthorityPolicyConsumer'
  payload: TerminalAuthorityPolicyConsumerRetirement
}>

export type DaemonTerminalAuthorityOutcomeRequest =
  | AcceptTerminalAuthorityNamespaceBoundaryRequest
  | AcknowledgeTerminalAuthorityNamespaceOutcomeRequest
  | RetireTerminalAuthorityPolicyConsumerRequest
