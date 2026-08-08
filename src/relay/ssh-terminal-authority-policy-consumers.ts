import { randomUUID } from 'node:crypto'
import {
  TERMINAL_AUTHORITY_CONSUMER_PROOF_CAPABILITY,
  parseTerminalAuthorityNamespaceAdmissionProof,
  parseTerminalAuthorityNamespaceAdmissionStart
} from '../shared/terminal-session-authority-consumer-proof'
import {
  parseTerminalAuthorityConsumerRetirementProof,
  parseTerminalAuthorityConsumerRetirementStart
} from '../shared/terminal-session-authority-consumer-retirement'
import type { TerminalAuthorityNamespace } from '../shared/terminal-session-authority-identity'
import { terminalAuthorityHostAppConsumerId } from '../main/session-authority/terminal-session-authority-consumer-proof'
import type { TerminalSessionAuthorityPtyLifecycle } from '../main/session-authority/terminal-session-authority-pty-lifecycle'
import type { TerminalAuthorityPolicyConsumerConnection } from '../main/session-authority/terminal-session-authority-policy-consumers'
import { joinTerminalAuthorityRollbackFailure } from '../main/session-authority/terminal-session-authority-consumer-rollback-failure'
import {
  SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_METHOD,
  SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD
} from '../main/ssh/ssh-terminal-authority-consumer-methods'
import type { RelayClientSessionIdentity, RelayDispatcher, RequestContext } from './dispatcher'
import { SshTerminalAuthorityClientConsumers } from './ssh-terminal-authority-client-consumers'
import { SshTerminalAuthorityPolicyPublication } from './ssh-terminal-authority-policy-publication'
import {
  SshTerminalAuthorityPolicyOperations,
  type SshTerminalAuthorityPendingNamespace
} from './ssh-terminal-authority-policy-operations'

export class SshTerminalAuthorityPolicyConsumers {
  private readonly clients = new Map<number, SshTerminalAuthorityClientConsumers>()
  private readonly pending = new Map<number, Set<SshTerminalAuthorityPendingNamespace>>()
  private disposed = false

  constructor(
    private readonly dispatcher: RelayDispatcher,
    private readonly authority: TerminalSessionAuthorityPtyLifecycle,
    private readonly onRollbackFailure: (error: unknown) => void = reportRollbackFailure
  ) {
    dispatcher.onRequest(SSH_TERMINAL_AUTHORITY_CONSUMER_CHALLENGE_METHOD, (params, context) =>
      this.issueChallenge(params, context)
    )
    dispatcher.onRequest(SSH_TERMINAL_AUTHORITY_CONSUMER_GRANT_METHOD, (params, context) =>
      this.prepareGrant(params, context)
    )
    dispatcher.onRequest(
      SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CHALLENGE_METHOD,
      (params, context) => this.issueRetirementChallenge(params, context)
    )
    dispatcher.onRequest(SSH_TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_METHOD, (params, context) =>
      this.retireConsumer(params, context)
    )
    dispatcher.onRequest(
      SSH_TERMINAL_AUTHORITY_CONSUMER_RESOLVE_NAMESPACE_METHOD,
      (params, context) => this.resolveNamespace(params, context)
    )
    new SshTerminalAuthorityPolicyOperations(dispatcher, {
      requireClient: (context) => this.requireClient(context),
      pending: (clientId) => this.pending.get(clientId)
    })
  }

  installTransport(
    clientId: number,
    identity: RelayClientSessionIdentity,
    consumerRetirementSupported = false
  ): void {
    if (this.disposed || !identity.authenticated || identity.authenticationKind === 'unproved') {
      throw new Error('SSH terminal authority authenticated transport is unavailable')
    }
    this.disconnect(clientId)
    const client = new SshTerminalAuthorityClientConsumers(
      identity,
      randomUUID(),
      TERMINAL_AUTHORITY_CONSUMER_PROOF_CAPABILITY,
      consumerRetirementSupported,
      () => this.disconnect(clientId)
    )
    this.clients.set(clientId, client)
  }

  disconnect(clientId: number): void {
    const pending = this.pending.get(clientId)
    this.pending.delete(clientId)
    for (const entry of pending ?? []) {
      entry.active = false
      entry.publication.close()
      const preparation = entry.preparation
      if (preparation) {
        const cause = new Error('SSH terminal authority client disconnected during admission')
        void joinTerminalAuthorityRollbackFailure(cause, () => preparation.rollback()).catch(
          (failure) => {
            if (failure !== cause) {
              this.onRollbackFailure(failure)
            }
          }
        )
      }
    }
    const client = this.clients.get(clientId)
    this.clients.delete(clientId)
    client?.disconnect()
    if (client) {
      this.authority.releaseAuthenticatedPolicyConsumerTransport(client.transport.token)
    }
  }

  isInstalled(clientId: number): boolean {
    return this.connection(clientId) !== null
  }

  connection(clientId: number): TerminalAuthorityPolicyConsumerConnection | null {
    return this.clients.get(clientId)?.connection() ?? null
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const clientId of [...this.clients.keys(), ...this.pending.keys()]) {
      this.disconnect(clientId)
    }
  }

  private async issueChallenge(params: Record<string, unknown>, context: RequestContext) {
    const client = this.requireClient(context)
    const start = parseTerminalAuthorityNamespaceAdmissionStart(params.start ?? params)
    if (!start) {
      throw new Error('SSH terminal authority admission start is invalid')
    }
    return await this.authority.issuePolicyConsumerChallenge(start, client.transport)
  }

  private async resolveNamespace(params: Record<string, unknown>, context: RequestContext) {
    this.requireClient(context)
    if (typeof params.worktreeId !== 'string') {
      throw new Error('SSH terminal authority namespace resolution is invalid')
    }
    return await this.authority.resolvePolicyConsumerNamespace(params.worktreeId)
  }

  private async issueRetirementChallenge(params: Record<string, unknown>, context: RequestContext) {
    const client = this.requireClient(context)
    this.requireConsumerRetirement(client)
    const start = parseTerminalAuthorityConsumerRetirementStart(params.start ?? params)
    if (!start) {
      throw new Error('SSH terminal authority consumer retirement start is invalid')
    }
    return await this.authority.issuePolicyConsumerRetirementChallenge(start, client.transport)
  }

  private async retireConsumer(params: Record<string, unknown>, context: RequestContext) {
    const client = this.requireClient(context)
    this.requireConsumerRetirement(client)
    const proof = parseTerminalAuthorityConsumerRetirementProof(params.proof ?? params)
    if (!proof) {
      throw new Error('SSH terminal authority consumer retirement proof is invalid')
    }
    const result = await this.authority.retireAuthenticatedPolicyConsumer(proof, client.transport)
    const installed = client.installed(result.namespace)
    if (installed?.session.grant.consumer.consumerId === result.consumerId) {
      client.remove(result.namespace)
    }
    return result
  }

  private async prepareGrant(params: Record<string, unknown>, context: RequestContext) {
    const client = this.requireClient(context)
    const proof = parseTerminalAuthorityNamespaceAdmissionProof(params.proof ?? params)
    if (!proof) {
      throw new Error('SSH terminal authority admission proof is invalid')
    }
    const publication = new SshTerminalAuthorityPolicyPublication(
      this.dispatcher,
      context.clientId,
      (error) => this.failNamespace(context.clientId, proof.challenge.namespace, error)
    )
    const pending: SshTerminalAuthorityPendingNamespace = {
      active: true,
      preparation: null,
      publication,
      namespace: Object.freeze({ ...proof.challenge.namespace }),
      requestId: proof.challenge.requestId,
      connectionGrantId: proof.challenge.connectionGrantId,
      consumer: Object.freeze({
        consumerId: terminalAuthorityHostAppConsumerId(
          proof.challenge.namespace.authorityHostId,
          Uint8Array.from(Buffer.from(proof.challenge.appPublicKeyB64, 'base64'))
        ),
        consumerIncarnationId: proof.challenge.candidateProcessIncarnationId
      })
    }
    this.pendingFor(context.clientId).add(pending)
    try {
      pending.preparation = await this.authority.prepareAuthenticatedPolicyConsumerNamespace(
        proof,
        client.transport,
        publication.transport()
      )
    } catch (error) {
      pending.active = false
      this.pending.get(context.clientId)?.delete(pending)
      publication.close()
      throw error
    }
    if (!pending.active || this.clients.get(context.clientId) !== client) {
      pending.active = false
      this.pending.get(context.clientId)?.delete(pending)
      publication.close()
      const preparation = pending.preparation
      if (!preparation) {
        throw new Error('SSH terminal authority authenticated transport is unavailable')
      }
      return await joinTerminalAuthorityRollbackFailure(
        new Error('SSH terminal authority authenticated transport is unavailable'),
        () => preparation.rollback()
      )
    }
    const preparation = pending.preparation
    if (!preparation) {
      throw new Error('SSH terminal authority authenticated transport is unavailable')
    }
    try {
      const session = await preparation.commit()
      if (!pending.active || this.clients.get(context.clientId) !== client) {
        session.disconnect()
        throw new Error('SSH terminal authority authenticated transport is unavailable')
      }
      client.install(Object.freeze({ session, publication: pending.publication }))
      return preparation.grant
    } catch (error) {
      pending.publication.close()
      try {
        return await joinTerminalAuthorityRollbackFailure(error, () => preparation.rollback())
      } catch (failure) {
        if (failure !== error) {
          this.onRollbackFailure(failure)
        }
        this.failNamespace(context.clientId, pending.namespace, failure)
        throw failure
      }
    } finally {
      this.pending.get(context.clientId)?.delete(pending)
      pending.active = false
    }
  }

  private failNamespace(
    clientId: number,
    namespace: TerminalAuthorityNamespace,
    _error: unknown
  ): void {
    const client = this.clients.get(clientId)
    if (!client?.installed(namespace)) {
      return
    }
    client.remove(namespace)
  }

  private requireClient(context: RequestContext): SshTerminalAuthorityClientConsumers {
    const client = this.clients.get(context.clientId)
    const actual = context.sessionIdentity
    if (
      this.disposed ||
      !client ||
      !actual?.authenticated ||
      actual.authenticationKind === 'unproved' ||
      actual.principal !== client.identity.principal
    ) {
      throw new Error('SSH terminal authority authenticated transport is unavailable')
    }
    return client
  }

  private requireConsumerRetirement(client: SshTerminalAuthorityClientConsumers): void {
    if (!client.consumerRetirementSupported) {
      throw new Error('SSH terminal authority consumer retirement is unsupported')
    }
  }

  private pendingFor(clientId: number): Set<SshTerminalAuthorityPendingNamespace> {
    const pending = this.pending.get(clientId) ?? new Set<SshTerminalAuthorityPendingNamespace>()
    this.pending.set(clientId, pending)
    return pending
  }
}

function reportRollbackFailure(error: unknown): void {
  console.error('SSH terminal authority consumer rollback failed', error)
}
