import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import {
  sameTerminalAuthorityPolicyConsumer,
  type TerminalAuthorityNamespaceOutcomeAck,
  type TerminalAuthorityPolicyConsumerClaim,
  type TerminalAuthorityPolicyConsumerIdentity
} from '../../shared/terminal-session-authority-consumer-transport'
import type { TerminalAuthorityConsumerAdmissionSeal } from './terminal-session-authority-consumer-admission-seal'
import {
  terminalAuthorityPolicyNamespacePreparation,
  type TerminalAuthorityPolicyNamespacePreparation
} from './terminal-session-authority-policy-namespace-preparation'
import { TerminalSessionAuthorityPolicyConsumerSession } from './terminal-session-authority-policy-consumer-session'
import type { TerminalAuthorityPolicyOutcomeTransport } from './terminal-session-authority-policy-outcome-transport'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'

export type { TerminalAuthorityPolicyOutcomeTransport } from './terminal-session-authority-policy-outcome-transport'

export type TerminalAuthorityPolicyConsumerConnection = Readonly<{
  identity: TerminalAuthorityPolicyConsumerIdentity
  activate(): Promise<void>
  prepareNamespace?(
    service: TerminalSessionAuthorityService,
    seal?: TerminalAuthorityConsumerAdmissionSeal
  ): Promise<TerminalAuthorityPolicyNamespacePreparation>
  /** Asserts only. Every durable claim goes through authenticated admission, so this never claims. */
  ensureNamespace(service: TerminalSessionAuthorityService): Promise<void>
  assertInstalled(namespace: TerminalAuthorityNamespace): void
  acknowledge(ack: TerminalAuthorityNamespaceOutcomeAck): Promise<number>
  retire(): Promise<number>
  isInstalled(namespace: TerminalAuthorityNamespace): boolean
  disconnect(): void
}>

export type { TerminalAuthorityPolicyNamespacePreparation } from './terminal-session-authority-policy-namespace-preparation'

export type TerminalAuthorityPolicyConsumerResolver = Readonly<{
  forNamespace(namespace: TerminalAuthorityNamespace): TerminalAuthorityPolicyConsumerConnection
}>

export type TerminalAuthorityPolicyConsumerSource =
  | TerminalAuthorityPolicyConsumerConnection
  | TerminalAuthorityPolicyConsumerResolver

export function terminalAuthorityPolicyConsumerForNamespace(
  source: TerminalAuthorityPolicyConsumerSource,
  namespace: TerminalAuthorityNamespace
): TerminalAuthorityPolicyConsumerConnection {
  return 'forNamespace' in source ? source.forNamespace(namespace) : source
}

export class TerminalSessionAuthorityPolicyConsumers {
  private readonly connections = new Map<object, TerminalSessionAuthorityPolicyConsumerSession>()
  private readonly pendingConnections = new Map<
    object,
    TerminalSessionAuthorityPolicyConsumerSession
  >()
  private readonly namespaceOwners = new Map<
    string,
    TerminalSessionAuthorityPolicyConsumerSession
  >()
  private nextGeneration = 0

  hasInstalledTransport(): boolean {
    return this.namespaceOwners.size > 0
  }

  dispose(): void {
    for (const connection of this.connections.values()) {
      connection.disconnect()
    }
    for (const connection of this.pendingConnections.values()) {
      connection.disconnect()
    }
    this.connections.clear()
    this.pendingConnections.clear()
    this.namespaceOwners.clear()
  }

  async connect(
    claim: TerminalAuthorityPolicyConsumerClaim,
    transport: TerminalAuthorityPolicyOutcomeTransport
  ): Promise<TerminalAuthorityPolicyConsumerConnection> {
    let connection!: TerminalSessionAuthorityPolicyConsumerSession
    connection = new TerminalSessionAuthorityPolicyConsumerSession(
      ++this.nextGeneration,
      claim.consumer,
      claim.expectedConsumerIncarnationId,
      transport,
      () => this.assertOwned(connection),
      (namespace) => this.assertNamespaceOwner(connection, namespace),
      (namespace) => this.releaseNamespace(connection, namespace)
    )
    this.pendingConnections.set(connection.token, connection)
    return this.connectionAccess(connection)
  }

  private connectionAccess(
    connection: TerminalSessionAuthorityPolicyConsumerSession
  ): TerminalAuthorityPolicyConsumerConnection {
    return Object.freeze({
      identity: connection.identity,
      activate: () => this.activate(connection),
      prepareNamespace: (service, seal) => this.prepareNamespace(connection, service, seal),
      ensureNamespace: async (service) => this.assertInstalled(connection, service.namespace),
      assertInstalled: (namespace) => this.assertInstalled(connection, namespace),
      acknowledge: (ack) => this.acknowledge(connection, structuredClone(ack)),
      retire: () => this.retire(connection),
      isInstalled: (namespace) => connection.isInstalled(namespace),
      disconnect: () => this.disconnect(connection)
    })
  }

  private async prepareNamespace(
    connection: TerminalSessionAuthorityPolicyConsumerSession,
    service: TerminalSessionAuthorityService,
    seal?: TerminalAuthorityConsumerAdmissionSeal
  ): Promise<TerminalAuthorityPolicyNamespacePreparation> {
    this.assertCurrent(connection)
    try {
      await connection.stageNamespace(service)
      this.assertCurrent(connection)
    } catch (error) {
      // Staging holds the producer while it publishes the boundary; a failed stage must release it.
      connection.displaceNamespace(service.namespace)
      throw error
    }
    return terminalAuthorityPolicyNamespacePreparation({
      connection,
      service,
      seal,
      assertCurrent: () => this.assertCurrent(connection),
      assertClaimable: () => this.assertNamespaceClaimable(connection, service.namespace),
      installOwner: () => this.installNamespaceOwner(connection, service.namespace)
    })
  }

  private assertInstalled(
    connection: TerminalSessionAuthorityPolicyConsumerSession,
    namespace: TerminalAuthorityNamespace
  ): void {
    this.assertCurrent(connection)
    connection.assertInstalled(namespace)
  }

  async activate(connection: TerminalSessionAuthorityPolicyConsumerSession): Promise<void> {
    this.assertOwned(connection)
    if (this.connections.get(connection.token) === connection) {
      connection.activate()
      return
    }
    if (this.pendingConnections.get(connection.token) !== connection) {
      throw new Error('terminal authority policy consumer transport is stale')
    }
    connection.activate()
    this.pendingConnections.delete(connection.token)
    this.connections.set(connection.token, connection)
  }

  private acknowledge(
    connection: TerminalSessionAuthorityPolicyConsumerSession,
    ack: TerminalAuthorityNamespaceOutcomeAck
  ): Promise<number> {
    return this.acknowledgeCurrent(connection, ack)
  }

  private async acknowledgeCurrent(
    connection: TerminalSessionAuthorityPolicyConsumerSession,
    ack: TerminalAuthorityNamespaceOutcomeAck
  ): Promise<number> {
    this.assertConnectionIdentity(connection, ack.consumer)
    const sequence = await connection.acknowledge(ack)
    this.assertConnectionIdentity(connection, ack.consumer)
    return sequence
  }

  private async retire(connection: TerminalSessionAuthorityPolicyConsumerSession): Promise<number> {
    this.assertCurrent(connection)
    const retired = await connection.retire()
    this.removeOwned(connection)
    return retired
  }

  private disconnect(connection: TerminalSessionAuthorityPolicyConsumerSession): void {
    this.removeOwned(connection)
    connection.disconnect()
  }

  private assertConnectionIdentity(
    connection: TerminalSessionAuthorityPolicyConsumerSession,
    identity: TerminalAuthorityPolicyConsumerIdentity
  ): void {
    this.assertCurrent(connection)
    if (!sameTerminalAuthorityPolicyConsumer(connection.identity, identity)) {
      throw new Error('terminal authority policy consumer transport is stale')
    }
  }

  private assertCurrent(connection: TerminalSessionAuthorityPolicyConsumerSession): void {
    if (!connection.isActive || this.connections.get(connection.token) !== connection) {
      throw new Error('terminal authority policy consumer transport is stale')
    }
  }

  private assertOwned(connection: TerminalSessionAuthorityPolicyConsumerSession): void {
    if (!connection.isActive) {
      throw new Error('terminal authority policy consumer transport is stale')
    }
    if (
      this.connections.get(connection.token) !== connection &&
      this.pendingConnections.get(connection.token) !== connection
    ) {
      throw new Error('terminal authority policy consumer transport is stale')
    }
  }

  private assertNamespaceOwner(
    connection: TerminalSessionAuthorityPolicyConsumerSession,
    namespace: TerminalAuthorityNamespace
  ): void {
    this.assertCurrent(connection)
    if (
      this.namespaceOwners.get(namespaceKey(connection.identity.consumerId, namespace)) !==
      connection
    ) {
      throw new Error('terminal authority policy consumer namespace is stale')
    }
  }

  private removeOwned(connection: TerminalSessionAuthorityPolicyConsumerSession): void {
    this.connections.delete(connection.token)
    this.pendingConnections.delete(connection.token)
    for (const [key, owner] of this.namespaceOwners) {
      if (owner === connection) {
        this.namespaceOwners.delete(key)
      }
    }
  }

  // Non-fallible by contract: `assertNamespaceClaimable` already ran inside the same seal.
  private installNamespaceOwner(
    connection: TerminalSessionAuthorityPolicyConsumerSession,
    namespace: TerminalAuthorityNamespace
  ): void {
    const key = namespaceKey(connection.identity.consumerId, namespace)
    const previous = this.namespaceOwners.get(key)
    this.namespaceOwners.set(key, connection)
    if (previous && previous !== connection) {
      previous.displaceNamespace(namespace)
    }
  }

  private assertNamespaceClaimable(
    connection: TerminalSessionAuthorityPolicyConsumerSession,
    namespace: TerminalAuthorityNamespace
  ): void {
    const current = this.namespaceOwners.get(
      namespaceKey(connection.identity.consumerId, namespace)
    )
    if (current && current !== connection && current.generation > connection.generation) {
      throw new Error('terminal authority policy consumer namespace is stale')
    }
  }

  private releaseNamespace(
    connection: TerminalSessionAuthorityPolicyConsumerSession,
    namespace: TerminalAuthorityNamespace
  ): void {
    const key = namespaceKey(connection.identity.consumerId, namespace)
    if (this.namespaceOwners.get(key) === connection) {
      this.namespaceOwners.delete(key)
    }
  }
}

function namespaceKey(consumerId: string, namespace: TerminalAuthorityNamespace): string {
  return JSON.stringify([consumerId, namespace.authorityHostId, namespace.namespaceId])
}
