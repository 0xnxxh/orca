import type {
  TerminalAuthorityNamespaceOutcomeBoundary,
  TerminalAuthorityNamespaceOutcomePublication
} from '../../shared/terminal-session-authority-consumer-transport'

export type TerminalAuthorityPolicyOutcomeTransport = Readonly<{
  publishBoundary(boundary: TerminalAuthorityNamespaceOutcomeBoundary): Promise<void>
  publishOutcome(publication: TerminalAuthorityNamespaceOutcomePublication): Promise<void>
  onFailure?(error: Error): void
}>
