import type {
  TerminalAuthorityNamespaceAdmissionCancellation,
  TerminalAuthorityNamespaceAdmissionProof,
  TerminalAuthorityNamespaceAdmissionStart
} from '../../shared/terminal-session-authority-consumer-proof'
import type {
  TerminalAuthorityConsumerRetirementProof,
  TerminalAuthorityConsumerRetirementStart
} from '../../shared/terminal-session-authority-consumer-retirement'

export const DAEMON_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_REQUEST =
  'beginTerminalAuthorityConsumerAdmission' as const
export const DAEMON_TERMINAL_AUTHORITY_CONSUMER_GRANT_REQUEST =
  'completeTerminalAuthorityConsumerAdmission' as const
export const DAEMON_TERMINAL_AUTHORITY_CONSUMER_CANCEL_REQUEST =
  'cancelTerminalAuthorityConsumerAdmission' as const
export const DAEMON_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_REQUEST =
  'resolveTerminalAuthorityConsumerNamespace' as const
export const DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_REQUEST =
  'beginTerminalAuthorityConsumerRetirement' as const
export const DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_REQUEST =
  'completeTerminalAuthorityConsumerRetirement' as const

export type DaemonTerminalAuthorityConsumerRequest =
  | Readonly<{
      id: string
      type: typeof DAEMON_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_REQUEST
      payload: Readonly<{ worktreeId: string }>
    }>
  | Readonly<{
      id: string
      type: typeof DAEMON_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_REQUEST
      payload: TerminalAuthorityNamespaceAdmissionStart
    }>
  | Readonly<{
      id: string
      type: typeof DAEMON_TERMINAL_AUTHORITY_CONSUMER_GRANT_REQUEST
      payload: TerminalAuthorityNamespaceAdmissionProof
    }>
  | Readonly<{
      id: string
      type: typeof DAEMON_TERMINAL_AUTHORITY_CONSUMER_CANCEL_REQUEST
      payload: TerminalAuthorityNamespaceAdmissionCancellation
    }>
  | Readonly<{
      id: string
      type: typeof DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_REQUEST
      payload: TerminalAuthorityConsumerRetirementStart
    }>
  | Readonly<{
      id: string
      type: typeof DAEMON_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_REQUEST
      payload: TerminalAuthorityConsumerRetirementProof
    }>
