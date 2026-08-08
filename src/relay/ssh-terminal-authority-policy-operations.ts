import { parseTerminalAuthorityNamespaceAdmissionCancellation } from '../shared/terminal-session-authority-consumer-proof'
import type { TerminalAuthorityNamespace } from '../shared/terminal-session-authority-identity'
import {
  TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_ACCEPT_METHOD,
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_ACK_METHOD,
  parseTerminalAuthorityNamespaceBoundaryAcceptance,
  parseTerminalAuthorityNamespaceOutcomeAck,
  sameTerminalAuthorityPolicyConsumer,
  type TerminalAuthorityPolicyConsumerIdentity
} from '../shared/terminal-session-authority-consumer-transport'
import type { TerminalAuthorityAuthenticatedNamespacePreparation } from '../main/session-authority/terminal-session-authority-authenticated-consumers'
import { SSH_TERMINAL_AUTHORITY_CONSUMER_CANCEL_METHOD } from '../main/ssh/ssh-terminal-authority-consumer-methods'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import type {
  SshTerminalAuthorityClientConsumers,
  SshTerminalAuthorityInstalledNamespace
} from './ssh-terminal-authority-client-consumers'
import type { SshTerminalAuthorityPolicyPublication } from './ssh-terminal-authority-policy-publication'

export type SshTerminalAuthorityPendingNamespace = {
  active: boolean
  preparation: TerminalAuthorityAuthenticatedNamespacePreparation | null
  publication: SshTerminalAuthorityPolicyPublication
  namespace: TerminalAuthorityNamespace
  requestId: string
  connectionGrantId: string
  consumer: TerminalAuthorityPolicyConsumerIdentity
}

type OperationsOptions = Readonly<{
  requireClient(context: RequestContext): SshTerminalAuthorityClientConsumers
  pending(clientId: number): Set<SshTerminalAuthorityPendingNamespace> | undefined
}>

export class SshTerminalAuthorityPolicyOperations {
  constructor(
    dispatcher: RelayDispatcher,
    private readonly options: OperationsOptions
  ) {
    dispatcher.onRequest(SSH_TERMINAL_AUTHORITY_CONSUMER_CANCEL_METHOD, (params, context) =>
      this.cancel(params, context)
    )
    dispatcher.onRequest(TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_ACCEPT_METHOD, (params, context) =>
      this.acceptBoundary(params, context)
    )
    dispatcher.onRequest(TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_ACK_METHOD, (params, context) =>
      this.acknowledge(params, context)
    )
  }

  private async cancel(
    params: Record<string, unknown>,
    context: RequestContext
  ): Promise<{ canceled: boolean }> {
    const client = this.options.requireClient(context)
    const cancellation = parseTerminalAuthorityNamespaceAdmissionCancellation(
      params.cancellation ?? params
    )
    if (!cancellation || cancellation.connectionGrantId !== client.transport.connectionGrantId) {
      throw new Error('SSH terminal authority namespace cancellation is unauthorized')
    }
    let canceled = false
    for (const pending of this.options.pending(context.clientId) ?? []) {
      if (
        pending.requestId === cancellation.requestId &&
        pending.connectionGrantId === cancellation.connectionGrantId &&
        sameNamespace(pending.namespace, cancellation.namespace) &&
        sameTerminalAuthorityPolicyConsumer(pending.consumer, cancellation.consumer)
      ) {
        this.options.pending(context.clientId)?.delete(pending)
        pending.active = false
        pending.publication.close()
        await pending.preparation?.rollback()
        canceled = true
      }
    }
    const installed = client.installed(cancellation.namespace)
    if (installed && grantMatches(installed, cancellation)) {
      client.remove(cancellation.namespace)
      canceled = true
    }
    return { canceled }
  }

  private acceptBoundary(params: Record<string, unknown>, context: RequestContext): Promise<void> {
    const client = this.options.requireClient(context)
    const acceptance = parseTerminalAuthorityNamespaceBoundaryAcceptance(
      params.acceptance ?? params
    )
    const installed = acceptance ? client.installed(acceptance.namespace) : null
    const pending = acceptance
      ? [...(this.options.pending(context.clientId) ?? [])].find(
          (entry) =>
            entry.active &&
            sameNamespace(entry.namespace, acceptance.namespace) &&
            sameTerminalAuthorityPolicyConsumer(entry.consumer, acceptance.consumer)
        )
      : undefined
    if (
      !acceptance ||
      (!pending &&
        (!installed ||
          !sameTerminalAuthorityPolicyConsumer(
            installed.session.grant.consumer,
            acceptance.consumer
          )))
    ) {
      throw new Error('SSH terminal authority boundary acceptance is unauthorized')
    }
    ;(pending?.publication ?? installed!.publication).accept(acceptance)
    return Promise.resolve()
  }

  private async acknowledge(
    params: Record<string, unknown>,
    context: RequestContext
  ): Promise<{ acknowledgedSequence: number }> {
    const client = this.options.requireClient(context)
    const ack = parseTerminalAuthorityNamespaceOutcomeAck(params.ack ?? params)
    const installed = ack ? client.installed(ack.namespace) : null
    if (
      !ack ||
      !installed ||
      !sameTerminalAuthorityPolicyConsumer(installed.session.grant.consumer, ack.consumer)
    ) {
      throw new Error('SSH terminal authority outcome ACK is unauthorized')
    }
    return { acknowledgedSequence: await installed.session.policyConsumer.acknowledge(ack) }
  }
}

function grantMatches(
  installed: SshTerminalAuthorityInstalledNamespace,
  cancellation: NonNullable<ReturnType<typeof parseTerminalAuthorityNamespaceAdmissionCancellation>>
): boolean {
  return (
    installed.session.grant.requestId === cancellation.requestId &&
    installed.session.grant.connectionGrantId === cancellation.connectionGrantId &&
    sameTerminalAuthorityPolicyConsumer(installed.session.grant.consumer, cancellation.consumer)
  )
}

function sameNamespace(
  left: TerminalAuthorityNamespace,
  right: TerminalAuthorityNamespace
): boolean {
  return left.authorityHostId === right.authorityHostId && left.namespaceId === right.namespaceId
}
