import type { SshChannelMultiplexer } from '../main/ssh/ssh-channel-multiplexer'
import {
  TERMINAL_AUTHORITY_TOPOLOGY_CHANGED_NOTIFICATION,
  TERMINAL_AUTHORITY_TOPOLOGY_PTY_CAPABILITY,
  TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD,
  TERMINAL_AUTHORITY_TOPOLOGY_UNSUBSCRIBE_NOTIFICATION,
  ptyCapabilitiesOfferTerminalAuthorityTopology,
  relayDaemonGrantHasTerminalAuthorityTopology
} from '../shared/terminal-authority-topology-stream-contract'
import type { RelayDispatcher, RequestContext } from './dispatcher'

export class TerminalAuthorityTopologyGateway {
  private pendingGrant = false
  private activeClientId: number | null = null

  constructor(
    private readonly dispatcher: RelayDispatcher,
    private readonly authorityMux: SshChannelMultiplexer,
    ownerCapabilities: readonly string[]
  ) {
    this.ownerHopGranted = relayDaemonGrantHasTerminalAuthorityTopology(ownerCapabilities)
    dispatcher.onRequest(TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD, (params, context) =>
      this.forwardSnapshot(params, context)
    )
    dispatcher.onNotification(
      TERMINAL_AUTHORITY_TOPOLOGY_UNSUBSCRIBE_NOTIFICATION,
      (params, context) => this.forwardUnsubscribe(params, context)
    )
  }

  private readonly ownerHopGranted: boolean

  prepareOpenClient(params: Record<string, unknown>): Record<string, unknown> {
    this.pendingGrant =
      this.ownerHopGranted && ptyCapabilitiesOfferTerminalAuthorityTopology(params.capabilities)
    return stripTopologyOffer(params)
  }

  grantOpenClient(result: unknown): unknown {
    if (typeof result !== 'object' || result === null) {
      return result
    }
    const record = result as Record<string, unknown>
    const capabilities =
      typeof record.capabilities === 'object' && record.capabilities !== null
        ? { ...(record.capabilities as Record<string, unknown>) }
        : {}
    delete capabilities[TERMINAL_AUTHORITY_TOPOLOGY_PTY_CAPABILITY]
    if (this.pendingGrant) {
      capabilities[TERMINAL_AUTHORITY_TOPOLOGY_PTY_CAPABILITY] = Object.freeze({ version: 1 })
    }
    return Object.freeze({
      ...record,
      ...(Object.keys(capabilities).length > 0 ? { capabilities } : {})
    })
  }

  settleAdmission(clientId: number, admitted: boolean): void {
    this.activeClientId = admitted && this.pendingGrant ? clientId : null
    this.pendingGrant = false
  }

  cancelPending(): void {
    this.pendingGrant = false
  }

  clear(): void {
    this.pendingGrant = false
    this.activeClientId = null
  }

  acceptAuthorityNotification(method: string, params: Record<string, unknown>): boolean {
    if (method !== TERMINAL_AUTHORITY_TOPOLOGY_CHANGED_NOTIFICATION) {
      return false
    }
    if (this.activeClientId !== null) {
      this.dispatcher.tryNotifyClient(this.activeClientId, method, params)
    }
    return true
  }

  private forwardSnapshot(
    params: Record<string, unknown>,
    context: RequestContext
  ): Promise<unknown> {
    this.assertGrantedClient(context)
    return this.authorityMux.request(TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD, params, {
      signal: context.signal
    })
  }

  private forwardUnsubscribe(params: Record<string, unknown>, context: RequestContext): void {
    if (this.activeClientId !== context.clientId) {
      return
    }
    this.authorityMux.notify(TERMINAL_AUTHORITY_TOPOLOGY_UNSUBSCRIBE_NOTIFICATION, params)
  }

  private assertGrantedClient(context: RequestContext): void {
    if (this.activeClientId !== context.clientId) {
      throw new Error('terminal_authority_topology_not_granted')
    }
  }
}

function stripTopologyOffer(params: Record<string, unknown>): Record<string, unknown> {
  if (typeof params.capabilities !== 'object' || params.capabilities === null) {
    return params
  }
  const capabilities = { ...(params.capabilities as Record<string, unknown>) }
  delete capabilities[TERMINAL_AUTHORITY_TOPOLOGY_PTY_CAPABILITY]
  const forwarded = { ...params }
  delete forwarded.capabilities
  return Object.keys(capabilities).length > 0 ? { ...forwarded, capabilities } : forwarded
}
