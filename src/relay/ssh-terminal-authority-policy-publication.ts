import {
  TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION,
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_NOTIFICATION,
  type TerminalAuthorityNamespaceBoundaryAcceptance
} from '../shared/terminal-session-authority-consumer-transport'
import { TerminalSessionAuthorityBoundaryAcceptances } from '../main/session-authority/terminal-session-authority-boundary-acceptance'
import type { TerminalAuthorityPolicyOutcomeTransport } from '../main/session-authority/terminal-session-authority-policy-consumers'
import type { RelayDispatcher } from './dispatcher'

export class SshTerminalAuthorityPolicyPublication {
  private readonly acceptances = new TerminalSessionAuthorityBoundaryAcceptances()

  constructor(
    private readonly dispatcher: RelayDispatcher,
    private readonly clientId: number,
    private readonly onFailure: (error: unknown) => void
  ) {}

  transport(): TerminalAuthorityPolicyOutcomeTransport {
    return Object.freeze({
      publishBoundary: async (boundary) => {
        const accepted = this.acceptances.wait(boundary)
        try {
          await this.publish(TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION, { boundary })
          await accepted
        } catch (error) {
          this.close(error instanceof Error ? error : new Error(String(error)))
          throw error
        }
      },
      publishOutcome: (publication) =>
        this.publish(TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_NOTIFICATION, { publication }),
      onFailure: (error) => this.onFailure(error)
    })
  }

  accept(acceptance: TerminalAuthorityNamespaceBoundaryAcceptance): void {
    this.acceptances.accept(acceptance)
  }

  close(error?: Error): void {
    this.acceptances.close(error)
  }

  private publish(method: string, params: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      const admitted = this.dispatcher.tryNotifyClient(
        this.clientId,
        method,
        params,
        (settlement) => (settlement.ok ? resolve() : reject(settlement.error)),
        { controlOverflow: 'close-client' }
      )
      if (!admitted) {
        reject(new Error('SSH terminal authority outcome transport is unavailable'))
      }
    })
  }
}
