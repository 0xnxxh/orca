import type { TerminalAuthorityTopologySnapshotRequest } from './terminal-authority-topology-stream-contract'
import { TERMINAL_AUTHORITY_TOPOLOGY_MAX_SUBSCRIPTIONS_PER_CONNECTION } from './terminal-authority-topology-stream-contract'

type Subscription<T> = Readonly<{
  request: TerminalAuthorityTopologySnapshotRequest
  value: T
}>

function sameNamespace(
  left: TerminalAuthorityTopologySnapshotRequest,
  right: TerminalAuthorityTopologySnapshotRequest
): boolean {
  return (
    left.namespace.authorityHostId === right.namespace.authorityHostId &&
    left.namespace.namespaceId === right.namespace.namespaceId
  )
}

export class TerminalAuthorityTopologySubscriptionRegistry<T> {
  private readonly subscriptions = new Map<string, Subscription<T>>()

  constructor(
    private readonly maxSubscriptions = TERMINAL_AUTHORITY_TOPOLOGY_MAX_SUBSCRIPTIONS_PER_CONNECTION
  ) {
    if (
      !Number.isSafeInteger(maxSubscriptions) ||
      maxSubscriptions < 1 ||
      maxSubscriptions > TERMINAL_AUTHORITY_TOPOLOGY_MAX_SUBSCRIPTIONS_PER_CONNECTION
    ) {
      throw new Error('terminal_authority_topology_subscription_capacity_invalid')
    }
  }

  get size(): number {
    return this.subscriptions.size
  }

  upsert(request: TerminalAuthorityTopologySnapshotRequest, value: T): T | null {
    const current = this.subscriptions.get(request.subscriptionId)
    if (current && !sameNamespace(current.request, request)) {
      throw new Error('terminal_authority_topology_subscription_identity_conflict')
    }
    if (!current && this.subscriptions.size >= this.maxSubscriptions) {
      throw new Error('terminal_authority_topology_subscription_capacity')
    }
    this.subscriptions.set(request.subscriptionId, Object.freeze({ request, value }))
    return current?.value ?? null
  }

  remove(request: TerminalAuthorityTopologySnapshotRequest): T | null {
    const current = this.subscriptions.get(request.subscriptionId)
    if (!current) {
      return null
    }
    if (!sameNamespace(current.request, request)) {
      throw new Error('terminal_authority_topology_subscription_identity_conflict')
    }
    this.subscriptions.delete(request.subscriptionId)
    return current.value
  }

  clear(): readonly T[] {
    const values = Object.freeze([...this.subscriptions.values()].map(({ value }) => value))
    this.subscriptions.clear()
    return values
  }
}
