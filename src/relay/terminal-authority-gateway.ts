import type { SshChannelMultiplexer } from '../main/ssh/ssh-channel-multiplexer'
import {
  TERMINAL_AUTHORITY_NOTIFICATION_METHODS,
  TERMINAL_AUTHORITY_REQUEST_METHODS,
  isTerminalAuthorityEventMethod,
  type TerminalAuthorityEventMethod,
  type TerminalAuthorityRequestMethod
} from '../shared/terminal-authority-routing'
import type { RelayDispatcher, RequestContext, ResponseSettlement } from './dispatcher'
import {
  TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION,
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_NOTIFICATION
} from '../shared/terminal-session-authority-consumer-transport'
import {
  TerminalAuthorityEventBuffer,
  TerminalAuthorityEventDelivery
} from './terminal-authority-event-delivery'
import { TerminalAuthorityTopologyGateway } from './terminal-authority-topology-gateway'
import {
  grantsExactOperations,
  grantsTerminalAuthorityExactOperations,
  requestsExactOperations,
  requestsTerminalAuthorityExactOperations
} from './terminal-authority-gateway-capabilities'
import {
  TerminalAuthorityResponseOrderBuffer,
  type TerminalAuthorityResponseOrderFence
} from './terminal-authority-response-order-buffer'
import {
  RESPONSE_ORDERED_REQUESTS,
  LEGACY_MUTATION_NOTIFICATIONS,
  EXACT_MUTATION_NOTIFICATIONS,
  AUTHORITY_EXACT_MUTATION_NOTIFICATIONS
} from './terminal-authority-gateway-rules'
import { assertTerminalAuthorityGatewayRequestAdmission } from './terminal-authority-gateway-request-admission'

export class TerminalAuthorityGateway {
  private activeClientId: number | null = null
  private pendingClientId: number | null = null
  private activeClientHasAuthorityExactOperations = false
  private pendingClientHasAuthorityExactOperations = false
  private readonly eventBuffer = new TerminalAuthorityEventBuffer()
  private readonly eventDelivery: TerminalAuthorityEventDelivery
  private readonly responseOrdering: TerminalAuthorityResponseOrderBuffer
  private readonly topologyGateway: TerminalAuthorityTopologyGateway
  private disposed = false
  private failed = false

  constructor(
    private readonly dispatcher: RelayDispatcher,
    private readonly authorityMux: SshChannelMultiplexer,
    private readonly onFailure: (error: Error) => void,
    ownerCapabilities: readonly string[] = []
  ) {
    this.eventDelivery = new TerminalAuthorityEventDelivery(
      dispatcher,
      this.eventBuffer,
      () => this.activeClientId,
      (error) => this.fail(error)
    )
    this.responseOrdering = new TerminalAuthorityResponseOrderBuffer(
      this.eventBuffer,
      (method, params) => this.eventDelivery.publish(method, params),
      (error) => this.fail(error)
    )
    this.topologyGateway = new TerminalAuthorityTopologyGateway(
      dispatcher,
      authorityMux,
      ownerCapabilities
    )
    for (const method of TERMINAL_AUTHORITY_REQUEST_METHODS) {
      dispatcher.onRequest(method, (params, context) =>
        this.forwardRequest(method, params, context)
      )
    }
    for (const method of TERMINAL_AUTHORITY_NOTIFICATION_METHODS) {
      dispatcher.onNotification(method, (params, context) => {
        this.forwardNotification(method, params, context)
      })
    }
    dispatcher.onClientDetached((clientId) => {
      if (this.activeClientId === clientId || this.pendingClientId === clientId) {
        this.fail(new Error('Terminal authority gateway client disconnected'))
      }
    })
    authorityMux.onNotification((method, params) => {
      if (this.topologyGateway.acceptAuthorityNotification(method, params)) {
        return
      }
      if (
        method === TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION ||
        method === TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_NOTIFICATION
      ) {
        this.forwardNamespaceOutcome(method, params)
        return
      }
      if (!isTerminalAuthorityEventMethod(method)) {
        this.fail(new Error(`Terminal authority published an unexpected event: ${method}`))
        return
      }
      this.acceptEvent(method, params)
    })
    authorityMux.onDispose((reason) => {
      if (!this.disposed) {
        this.fail(
          new Error(`Terminal authority gateway connection ${reason.replace('_', ' ')}`),
          false
        )
      }
    })
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.activeClientId = null
    this.pendingClientId = null
    this.activeClientHasAuthorityExactOperations = false
    this.pendingClientHasAuthorityExactOperations = false
    this.topologyGateway.clear()
    this.responseOrdering.clear()
    this.eventDelivery.clear()
    this.authorityMux.dispose('shutdown')
  }

  private async forwardRequest(
    method: TerminalAuthorityRequestMethod,
    params: Record<string, unknown>,
    context: RequestContext
  ): Promise<unknown> {
    assertTerminalAuthorityGatewayRequestAdmission(method, context, {
      activeClientId: this.activeClientId,
      pendingClientId: this.pendingClientId,
      activeClientHasAuthorityExactOperations: this.activeClientHasAuthorityExactOperations,
      unavailable: this.failed || this.disposed
    })
    const opensClient = method === 'pty.openClient'
    let forwardedParams = params
    if (opensClient) {
      if (!requestsExactOperations(params) || !requestsTerminalAuthorityExactOperations(params)) {
        throw new Error('terminal_authority_exact_operations_required')
      }
      this.pendingClientId = context.clientId
      this.pendingClientHasAuthorityExactOperations = false
      forwardedParams = this.topologyGateway.prepareOpenClient(params)
    }
    let responseFence: TerminalAuthorityResponseOrderFence | null = null
    if (RESPONSE_ORDERED_REQUESTS.has(method)) {
      if (!context.onResponseSettled || (opensClient && !context.onResponsePrepared)) {
        if (opensClient) {
          this.pendingClientId = null
          this.pendingClientHasAuthorityExactOperations = false
          this.topologyGateway.cancelPending()
        }
        throw new Error('terminal_authority_response_settlement_unavailable')
      }
      if (opensClient) {
        context.onResponsePrepared?.(() => this.activateAdmission(context.clientId))
      }
      if (method === 'pty.attach') {
        responseFence = this.responseOrdering.register(params.id)
      }
      context.onResponseSettled((settlement) => {
        if (opensClient) {
          this.settleAdmissionResponse(settlement, context.clientId)
        } else if (responseFence) {
          this.responseOrdering.settleFence(responseFence, settlement)
        }
      })
    }
    let result = await this.authorityMux.request(method, forwardedParams, {
      signal: context.signal,
      ...(method === 'pty.spawn'
        ? {
            beforeResolve: (result) => {
              responseFence = this.responseOrdering.register(
                (result as Record<string, unknown> | null)?.id
              )
            }
          }
        : {})
    })
    if (opensClient) {
      if (!grantsExactOperations(result) || !grantsTerminalAuthorityExactOperations(result)) {
        const error = new Error('terminal_authority_exact_operations_not_granted')
        this.fail(error)
        throw error
      }
      this.pendingClientHasAuthorityExactOperations = true
      result = this.topologyGateway.grantOpenClient(result)
    }
    return result
  }

  private forwardNotification(
    method: (typeof TERMINAL_AUTHORITY_NOTIFICATION_METHODS)[number],
    params: Record<string, unknown>,
    context: RequestContext
  ): void {
    if (this.activeClientId !== context.clientId) {
      return
    }
    if (LEGACY_MUTATION_NOTIFICATIONS.has(method)) {
      this.fail(new Error(`Terminal authority rejected legacy mutation ${method}`))
      return
    }
    if (EXACT_MUTATION_NOTIFICATIONS.has(method)) {
      this.fail(new Error(`Terminal authority rejected incarnation mutation ${method}`))
      return
    }
    if (
      AUTHORITY_EXACT_MUTATION_NOTIFICATIONS.has(method) &&
      !this.activeClientHasAuthorityExactOperations
    ) {
      this.fail(new Error(`Terminal authority rejected ungranted exact mutation ${method}`))
      return
    }
    if (!this.authorityMux.notify(method, params)) {
      this.fail(new Error(`Terminal authority rejected ${method}`))
    }
  }

  private acceptEvent(method: TerminalAuthorityEventMethod, params: Record<string, unknown>): void {
    if (this.responseOrdering.accept(this.pendingClientId !== null, method, params)) {
      return
    }
    this.eventDelivery.publish(method, params)
  }

  private forwardNamespaceOutcome(
    method:
      | typeof TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION
      | typeof TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_NOTIFICATION,
    params: Record<string, unknown>
  ): void {
    const clientId = this.activeClientId
    if (clientId === null || !this.dispatcher.tryNotifyClient(clientId, method, params)) {
      this.fail(new Error(`Terminal authority namespace outcome could not be forwarded: ${method}`))
    }
  }

  private activateAdmission(openingClientId: number): void {
    if (this.failed || this.disposed) {
      return
    }
    if (this.pendingClientId !== openingClientId) {
      this.fail(new Error('Terminal authority gateway admission preparation was stale'))
      return
    }
    this.activeClientId = openingClientId
    this.activeClientHasAuthorityExactOperations = this.pendingClientHasAuthorityExactOperations
    this.topologyGateway.settleAdmission(openingClientId, true)
  }

  private settleAdmissionResponse(settlement: ResponseSettlement, openingClientId: number): void {
    if (this.failed || this.disposed) {
      return
    }
    if (this.pendingClientId !== openingClientId) {
      this.fail(new Error('Terminal authority gateway admission settlement was stale'))
      return
    }
    if (!settlement.ok) {
      this.activeClientId = null
      this.activeClientHasAuthorityExactOperations = false
      this.pendingClientId = null
      this.pendingClientHasAuthorityExactOperations = false
      this.topologyGateway.settleAdmission(openingClientId, false)
      if (settlement.responseDelivered === true) {
        return
      }
      this.fail(
        new Error(
          `Terminal authority admission response did not reach the gateway client: ${settlement.error.message}`
        )
      )
      return
    }
    if (this.activeClientId !== openingClientId) {
      this.fail(new Error('Terminal authority gateway admission preparation was stale'))
      return
    }
    this.pendingClientId = null
    this.pendingClientHasAuthorityExactOperations = false
    const events = this.responseOrdering.takeAdmissionEvents()
    for (const event of events) {
      this.eventDelivery.publish(event.method, event.params)
    }
  }

  private fail(error: Error, closeAuthority = true): void {
    if (this.failed || this.disposed) {
      return
    }
    this.failed = true
    this.activeClientId = null
    this.pendingClientId = null
    this.activeClientHasAuthorityExactOperations = false
    this.pendingClientHasAuthorityExactOperations = false
    this.topologyGateway.clear()
    this.responseOrdering.clear()
    this.eventDelivery.clear()
    if (closeAuthority) {
      this.authorityMux.dispose('connection_lost')
    }
    this.onFailure(error)
  }
}
