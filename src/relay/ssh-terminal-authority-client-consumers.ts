import type { TerminalAuthorityNamespace } from '../shared/terminal-session-authority-identity'
import {
  sameTerminalAuthorityPolicyConsumer,
  type TerminalAuthorityNamespaceOutcomeAck,
  type TerminalAuthorityPolicyConsumerIdentity
} from '../shared/terminal-session-authority-consumer-transport'
import type { TerminalAuthorityAuthenticatedConsumerTransport } from '../main/session-authority/terminal-session-authority-consumer-admission'
import type { TerminalAuthorityAuthenticatedNamespaceSession } from '../main/session-authority/terminal-session-authority-authenticated-consumers'
import type { TerminalAuthorityPolicyConsumerConnection } from '../main/session-authority/terminal-session-authority-policy-consumers'
import type { TerminalSessionAuthorityService } from '../main/session-authority/terminal-session-authority-service'
import type { RelayClientSessionIdentity } from './dispatcher'
import type { SshTerminalAuthorityPolicyPublication } from './ssh-terminal-authority-policy-publication'

export type SshTerminalAuthorityInstalledNamespace = Readonly<{
  session: TerminalAuthorityAuthenticatedNamespaceSession
  publication: SshTerminalAuthorityPolicyPublication
}>

export class SshTerminalAuthorityClientConsumers {
  readonly transport: TerminalAuthorityAuthenticatedConsumerTransport
  private readonly namespaces = new Map<string, SshTerminalAuthorityInstalledNamespace>()
  private facade: TerminalAuthorityPolicyConsumerConnection | null = null

  constructor(
    readonly identity: RelayClientSessionIdentity,
    connectionGrantId: string,
    capability: string,
    readonly consumerRetirementSupported: boolean,
    private readonly disconnectClient: () => void
  ) {
    this.transport = Object.freeze({
      connectionGrantId,
      principal: identity.principal,
      capability,
      token: Object.freeze({})
    })
  }

  install(installed: SshTerminalAuthorityInstalledNamespace): void {
    const identity = installed.session.grant.consumer
    if (this.facade && !sameTerminalAuthorityPolicyConsumer(this.facade.identity, identity)) {
      throw new Error('SSH terminal authority consumer identity changed on one connection')
    }
    const key = namespaceKey(installed.session.grant.namespace)
    const current = this.namespaces.get(key)
    if (current?.session === installed.session) {
      installed.publication.close()
      return
    }
    if (current && current.session !== installed.session) {
      current.publication.close()
      current.session.disconnect()
    }
    this.namespaces.set(key, installed)
    this.facade ??= this.createFacade(identity)
  }

  connection(): TerminalAuthorityPolicyConsumerConnection | null {
    return this.namespaces.size > 0 ? this.facade : null
  }

  installed(namespace: TerminalAuthorityNamespace): SshTerminalAuthorityInstalledNamespace | null {
    return this.namespaces.get(namespaceKey(namespace)) ?? null
  }

  remove(namespace: TerminalAuthorityNamespace): void {
    const installed = this.namespaces.get(namespaceKey(namespace))
    installed?.publication.close()
    installed?.session.disconnect()
    this.namespaces.delete(namespaceKey(namespace))
    if (this.namespaces.size === 0) {
      this.facade = null
    }
  }

  disconnect(): void {
    for (const installed of this.namespaces.values()) {
      installed.publication.close()
      installed.session.disconnect()
    }
    this.namespaces.clear()
    this.facade = null
  }

  private createFacade(
    identity: TerminalAuthorityPolicyConsumerIdentity
  ): TerminalAuthorityPolicyConsumerConnection {
    return Object.freeze({
      identity: Object.freeze({ ...identity }),
      activate: async () => {},
      ensureNamespace: (service) => this.ensureNamespace(service),
      assertInstalled: (namespace) => this.assertInstalled(namespace),
      acknowledge: (ack) => this.acknowledge(ack),
      retire: () => this.retireAll(),
      isInstalled: (namespace) => this.isInstalled(namespace),
      disconnect: this.disconnectClient
    })
  }

  private async ensureNamespace(service: TerminalSessionAuthorityService): Promise<void> {
    this.assertInstalled(service.namespace)
  }

  private assertInstalled(namespace: TerminalAuthorityNamespace): void {
    const installed = this.installed(namespace)
    if (!installed || !installed.session.policyConsumer.isInstalled(namespace)) {
      throw new Error('SSH terminal authority namespace consumer is not installed')
    }
    installed.session.policyConsumer.assertInstalled(namespace)
  }

  private isInstalled(namespace: TerminalAuthorityNamespace): boolean {
    return this.installed(namespace)?.session.policyConsumer.isInstalled(namespace) === true
  }

  private acknowledge(ack: TerminalAuthorityNamespaceOutcomeAck): Promise<number> {
    const installed = this.installed(ack.namespace)
    if (!installed) {
      throw new Error('SSH terminal authority namespace consumer is not installed')
    }
    return installed.session.policyConsumer.acknowledge(ack)
  }

  private async retireAll(): Promise<number> {
    let retired = 0
    for (const installed of this.namespaces.values()) {
      retired += await installed.session.policyConsumer.retire()
    }
    this.disconnect()
    return retired
  }
}

function namespaceKey(namespace: TerminalAuthorityNamespace): string {
  return JSON.stringify([namespace.authorityHostId, namespace.namespaceId])
}
