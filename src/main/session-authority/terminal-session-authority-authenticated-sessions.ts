import type { TerminalAuthorityNamespaceAdmissionGrant } from '../../shared/terminal-session-authority-consumer-proof'
import type { TerminalAuthorityConsumerRetirementResult } from '../../shared/terminal-session-authority-consumer-retirement'
import type { TerminalAuthorityAuthenticatedConsumerTransport } from './terminal-session-authority-consumer-admission'
import type { TerminalAuthorityPolicyConsumerConnection } from './terminal-session-authority-policy-consumers'

export type TerminalAuthorityAuthenticatedNamespaceSession = Readonly<{
  grant: TerminalAuthorityNamespaceAdmissionGrant
  policyConsumer: TerminalAuthorityPolicyConsumerConnection
  disconnect(): void
}>

export class TerminalSessionAuthorityAuthenticatedSessions {
  private readonly byTransport = new Map<
    object,
    Set<TerminalAuthorityAuthenticatedNamespaceSession>
  >()

  remember(
    transport: TerminalAuthorityAuthenticatedConsumerTransport,
    grant: TerminalAuthorityNamespaceAdmissionGrant,
    policyConsumer: TerminalAuthorityPolicyConsumerConnection,
    releaseNamespace: () => void
  ): TerminalAuthorityAuthenticatedNamespaceSession {
    let active = true
    let session!: TerminalAuthorityAuthenticatedNamespaceSession
    session = Object.freeze({
      grant,
      policyConsumer,
      disconnect: () => {
        if (!active) {
          return
        }
        active = false
        policyConsumer.disconnect()
        releaseNamespace()
        const sessions = this.byTransport.get(transport.token)
        sessions?.delete(session)
        if (sessions?.size === 0) {
          this.byTransport.delete(transport.token)
        }
      }
    })
    const sessions = this.byTransport.get(transport.token) ?? new Set()
    sessions.add(session)
    this.byTransport.set(transport.token, sessions)
    return session
  }

  find(
    transportToken: object,
    grant: TerminalAuthorityNamespaceAdmissionGrant
  ): TerminalAuthorityAuthenticatedNamespaceSession | null {
    for (const session of this.byTransport.get(transportToken) ?? []) {
      if (
        session.grant.connectionGrantId === grant.connectionGrantId &&
        session.grant.consumer.consumerId === grant.consumer.consumerId &&
        session.grant.consumer.consumerIncarnationId === grant.consumer.consumerIncarnationId &&
        session.grant.namespace.authorityHostId === grant.namespace.authorityHostId &&
        session.grant.namespace.namespaceId === grant.namespace.namespaceId
      ) {
        return session
      }
    }
    return null
  }

  findByConsumer(
    transportToken: object,
    consumerId: string,
    namespace: TerminalAuthorityConsumerRetirementResult['namespace']
  ): TerminalAuthorityAuthenticatedNamespaceSession | null {
    for (const session of this.byTransport.get(transportToken) ?? []) {
      if (
        session.grant.consumer.consumerId === consumerId &&
        session.grant.namespace.authorityHostId === namespace.authorityHostId &&
        session.grant.namespace.namespaceId === namespace.namespaceId
      ) {
        return session
      }
    }
    return null
  }

  releaseTransport(transportToken: object): void {
    const sessions = this.byTransport.get(transportToken)
    if (sessions) {
      for (const session of sessions) {
        session.disconnect()
      }
    }
    this.byTransport.delete(transportToken)
  }

  transportTokens(): readonly object[] {
    return [...this.byTransport.keys()]
  }
}
