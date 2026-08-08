import type { TerminalSessionAuthorityService } from '../main/session-authority/terminal-session-authority-service'
import type { TerminalLegacyRecoveryNoticeProjection } from '../shared/terminal-legacy-cutover'
import type { TerminalAuthorityNamespace } from '../shared/terminal-session-authority-identity'
import {
  TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD,
  TERMINAL_AUTHORITY_TOPOLOGY_UNSUBSCRIBE_NOTIFICATION
} from '../shared/terminal-authority-topology-stream-contract'
import { TerminalAuthorityTopologySubscriptionRegistry } from '../shared/terminal-authority-topology-subscription-registry'
import { parseTerminalAuthorityTopologySnapshotRequest } from '../shared/terminal-authority-topology-stream-validation'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import {
  type TerminalAuthorityTopologyChannelSubscription,
  TerminalAuthorityTopologyNamespaceChannel
} from './terminal-authority-topology-namespace-channel'
import { assertAuthenticatedTerminalAuthorityControl } from './terminal-authority-control-protocol'

export type TerminalAuthorityTopologyPublisherRegistry = Readonly<{
  openNamespace: (namespace: TerminalAuthorityNamespace) => Promise<TerminalSessionAuthorityService>
  legacy: Readonly<{
    recoveryNoticesForNamespace: (
      namespace: TerminalAuthorityNamespace
    ) => TerminalLegacyRecoveryNoticeProjection
  }>
}>

type ChannelEntry = {
  promise: Promise<TerminalAuthorityTopologyNamespaceChannel>
  channel?: TerminalAuthorityTopologyNamespaceChannel
}

function namespaceKey(namespace: TerminalAuthorityNamespace): string {
  return JSON.stringify([namespace.authorityHostId, namespace.namespaceId])
}

export class TerminalAuthorityTopologyPublisher {
  private readonly clientSubscriptions = new Map<
    number,
    TerminalAuthorityTopologySubscriptionRegistry<TerminalAuthorityTopologyChannelSubscription>
  >()
  private readonly channels = new Map<string, ChannelEntry>()
  private readonly removeDetachListener: () => void
  private readonly removeDisposeListener: () => void
  private disposed = false

  constructor(
    private readonly dispatcher: RelayDispatcher,
    private readonly registry: TerminalAuthorityTopologyPublisherRegistry,
    private readonly onFailure: (error: Error) => void
  ) {
    dispatcher.onRequest(TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD, (params, context) =>
      this.snapshot(params, context)
    )
    dispatcher.onNotification(
      TERMINAL_AUTHORITY_TOPOLOGY_UNSUBSCRIBE_NOTIFICATION,
      (params, context) => this.unsubscribe(params, context)
    )
    this.removeDetachListener = dispatcher.onClientDetached((clientId) =>
      this.releaseClient(clientId)
    )
    this.removeDisposeListener = dispatcher.onDisposed(() => this.dispose())
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.removeDetachListener()
    this.removeDisposeListener()
    for (const clientId of this.clientSubscriptions.keys()) {
      this.releaseClient(clientId)
    }
    for (const entry of this.channels.values()) {
      entry.channel?.dispose()
      if (!entry.channel) {
        void entry.promise.then((channel) => channel.dispose()).catch(() => undefined)
      }
    }
    this.channels.clear()
  }

  private async snapshot(
    params: Record<string, unknown>,
    context: RequestContext
  ): Promise<unknown> {
    this.assertRequest(context)
    const request = parseTerminalAuthorityTopologySnapshotRequest(params)
    const channel = await this.channelFor(request.namespace)
    try {
      this.assertRequest(context)
    } catch (error) {
      this.releaseUnusedChannel(request.namespace, channel)
      throw error
    }
    const subscription = channel.subscribe(context.clientId, request.subscriptionId)
    try {
      const snapshot = await channel.captureSnapshot(request.subscriptionId)
      this.assertRequest(context)
      const subscriptions = this.subscriptionsForClient(context.clientId)
      const replaced = subscriptions.upsert(request, subscription)
      replaced?.dispose()
      return snapshot
    } catch (error) {
      subscription.dispose()
      throw error
    }
  }

  private unsubscribe(params: Record<string, unknown>, context: RequestContext): void {
    if (this.disposed) {
      return
    }
    assertAuthenticatedTerminalAuthorityControl(context)
    const request = parseTerminalAuthorityTopologySnapshotRequest(params)
    const subscriptions = this.clientSubscriptions.get(context.clientId)
    subscriptions?.remove(request)?.dispose()
    if (subscriptions?.size === 0) {
      this.clientSubscriptions.delete(context.clientId)
    }
  }

  private channelFor(
    namespace: TerminalAuthorityNamespace
  ): Promise<TerminalAuthorityTopologyNamespaceChannel> {
    const key = namespaceKey(namespace)
    const current = this.channels.get(key)
    if (current) {
      return current.promise
    }
    const entry = {} as ChannelEntry
    entry.promise = this.registry
      .openNamespace(namespace)
      .then((service) => {
        if (this.disposed) {
          throw new Error('terminal_authority_topology_publisher_disposed')
        }
        const channel = new TerminalAuthorityTopologyNamespaceChannel(
          service,
          {
            recoveryNoticesForNamespace: (value) =>
              this.registry.legacy.recoveryNoticesForNamespace(value)
          },
          {
            notify: (clientId, method, change) =>
              this.dispatcher.tryNotifyClient(clientId, method, { ...change }),
            disconnect: (clientId) => this.dispatcher.releaseDisplacedClient(clientId)
          },
          (empty) => this.releaseChannel(key, entry, empty),
          this.onFailure
        )
        entry.channel = channel
        return channel
      })
      .catch((error) => {
        if (this.channels.get(key) === entry) {
          this.channels.delete(key)
        }
        throw error
      })
    this.channels.set(key, entry)
    return entry.promise
  }

  private releaseChannel(
    key: string,
    entry: ChannelEntry,
    channel: TerminalAuthorityTopologyNamespaceChannel
  ): void {
    if (this.channels.get(key) !== entry || entry.channel !== channel) {
      return
    }
    this.channels.delete(key)
    channel.dispose()
  }

  private releaseUnusedChannel(
    namespace: TerminalAuthorityNamespace,
    channel: TerminalAuthorityTopologyNamespaceChannel
  ): void {
    if (channel.subscriptionCount !== 0) {
      return
    }
    const key = namespaceKey(namespace)
    const entry = this.channels.get(key)
    if (entry?.channel === channel) {
      this.releaseChannel(key, entry, channel)
    }
  }

  private subscriptionsForClient(
    clientId: number
  ): TerminalAuthorityTopologySubscriptionRegistry<TerminalAuthorityTopologyChannelSubscription> {
    const current = this.clientSubscriptions.get(clientId)
    if (current) {
      return current
    }
    const subscriptions =
      new TerminalAuthorityTopologySubscriptionRegistry<TerminalAuthorityTopologyChannelSubscription>()
    this.clientSubscriptions.set(clientId, subscriptions)
    return subscriptions
  }

  private releaseClient(clientId: number): void {
    const subscriptions = this.clientSubscriptions.get(clientId)
    if (!subscriptions) {
      return
    }
    this.clientSubscriptions.delete(clientId)
    for (const subscription of subscriptions.clear()) {
      subscription.dispose()
    }
  }

  private assertRequest(context: RequestContext): void {
    if (this.disposed) {
      throw new Error('terminal_authority_topology_publisher_disposed')
    }
    assertAuthenticatedTerminalAuthorityControl(context)
    if (context.isStale() || context.signal?.aborted) {
      throw new Error('terminal_authority_topology_request_stale')
    }
  }
}
