import { randomUUID } from 'node:crypto'
import {
  TERMINAL_AUTHORITY_TOPOLOGY_MAX_SUBSCRIPTIONS_PER_CONNECTION,
  type TerminalAuthorityTopologyCapabilityGrant
} from '../../shared/terminal-authority-topology-stream-contract'
import {
  assertAuthorityNamespace,
  type TerminalAuthorityNamespace
} from '../../shared/terminal-session-authority-identity'
import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import { SshTerminalAuthorityTopologyClient } from './ssh-terminal-authority-topology-client'
import {
  commitSshTerminalAuthorityTopologyState,
  initialSshTerminalAuthorityTopologyState,
  sshTerminalAuthorityTopologyCapabilityState,
  sshTerminalAuthorityTopologyDisconnectedState,
  sshTerminalAuthorityTopologyStaleState,
  sshTerminalAuthorityTopologySynchronizingState,
  type SshTerminalAuthorityNamespaceTopologyAttachOptions,
  type SshTerminalAuthorityNamespaceTopologySink,
  type SshTerminalAuthorityNamespaceTopologyState
} from './ssh-terminal-authority-topology-state'

export type {
  SshTerminalAuthorityNamespaceTopologyAttachOptions,
  SshTerminalAuthorityNamespaceTopologySink,
  SshTerminalAuthorityNamespaceTopologyState
} from './ssh-terminal-authority-topology-state'

type NamespaceEntry = {
  namespace: TerminalAuthorityNamespace
  subscriptionId: string
  sinks: Map<number, SshTerminalAuthorityNamespaceTopologySink>
  client: SshTerminalAuthorityTopologyClient | null
  state: SshTerminalAuthorityNamespaceTopologyState
  authorityCommitted: boolean
}

function namespaceKey(namespace: TerminalAuthorityNamespace): string {
  return JSON.stringify([namespace.authorityHostId, namespace.namespaceId])
}

export class SshTerminalAuthorityTopologyCoordinator {
  private readonly entries = new Map<string, NamespaceEntry>()
  private transport: SshChannelMultiplexer | null = null
  private capabilityGrant: TerminalAuthorityTopologyCapabilityGrant | null = null
  private connectionGeneration = 0
  private nextSinkId = 1
  private disposed = false

  attachResolvedNamespace(
    namespace: TerminalAuthorityNamespace,
    sink: SshTerminalAuthorityNamespaceTopologySink,
    options: SshTerminalAuthorityNamespaceTopologyAttachOptions = {}
  ): () => void {
    if (this.disposed) {
      throw new Error('terminal_authority_topology_coordinator_disposed')
    }
    assertAuthorityNamespace(namespace)
    const key = namespaceKey(namespace)
    let entry = this.entries.get(key)
    if (!entry) {
      if (this.entries.size >= TERMINAL_AUTHORITY_TOPOLOGY_MAX_SUBSCRIPTIONS_PER_CONNECTION) {
        throw new Error('terminal_authority_topology_subscription_capacity')
      }
      entry = {
        namespace: Object.freeze({ ...namespace }),
        subscriptionId: `topology-${randomUUID()}`,
        sinks: new Map(),
        client: null,
        state: this.initialState(options.durableCutoverCommitted === true),
        authorityCommitted: options.durableCutoverCommitted === true
      }
      this.entries.set(key, entry)
    } else if (options.durableCutoverCommitted === true) {
      this.commitAuthority(entry)
    }
    if (entry.sinks.size === 0) {
      entry.state = this.initialState(entry.authorityCommitted)
    }
    const sinkId = this.nextSinkId++
    entry.sinks.set(sinkId, sink)
    this.notifySink(sink, entry.state)
    if (!entry.client && this.transport && this.capabilityGrant) {
      void this.startEntry(entry, this.connectionGeneration).catch(() => {})
    }
    let attached = true
    return () => {
      if (!attached) {
        return
      }
      attached = false
      const current = this.entries.get(key)
      if (!current) {
        return
      }
      current.sinks.delete(sinkId)
      if (current.sinks.size === 0) {
        current.client?.dispose()
        current.client = null
        if (current.authorityCommitted) {
          current.state = this.initialState(true)
        } else {
          this.entries.delete(key)
        }
      }
    }
  }

  async onTopologyCapability(
    transport: SshChannelMultiplexer,
    capabilityGrant: TerminalAuthorityTopologyCapabilityGrant | null
  ): Promise<void> {
    if (this.disposed) {
      throw new Error('terminal_authority_topology_coordinator_disposed')
    }
    const generation = ++this.connectionGeneration
    this.transport = transport
    this.capabilityGrant = capabilityGrant
    for (const entry of this.entries.values()) {
      entry.client?.dispose()
      entry.client = null
    }
    if (!capabilityGrant) {
      for (const entry of this.entries.values()) {
        this.publish(entry, sshTerminalAuthorityTopologyCapabilityState(entry.authorityCommitted))
      }
      return
    }
    await Promise.all(
      [...this.entries.values()]
        .filter((entry) => entry.sinks.size > 0)
        .map((entry) => this.startEntry(entry, generation))
    )
  }

  detachTransport(transport: SshChannelMultiplexer): void {
    if (this.transport !== transport) {
      return
    }
    ++this.connectionGeneration
    this.transport = null
    this.capabilityGrant = null
    for (const entry of this.entries.values()) {
      entry.client?.dispose()
      entry.client = null
      this.publish(entry, sshTerminalAuthorityTopologyDisconnectedState(entry.authorityCommitted))
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    ++this.connectionGeneration
    this.transport = null
    this.capabilityGrant = null
    for (const entry of this.entries.values()) {
      entry.client?.dispose()
      entry.client = null
      this.publish(entry, Object.freeze({ kind: 'disposed' }))
    }
    this.entries.clear()
  }

  private initialState(authorityCommitted: boolean): SshTerminalAuthorityNamespaceTopologyState {
    return initialSshTerminalAuthorityTopologyState(
      authorityCommitted,
      this.transport !== null,
      this.capabilityGrant !== null
    )
  }

  private async startEntry(entry: NamespaceEntry, generation: number): Promise<void> {
    const transport = this.transport
    const capabilityGrant = this.capabilityGrant
    if (!transport || !capabilityGrant || generation !== this.connectionGeneration) {
      return
    }
    const client = new SshTerminalAuthorityTopologyClient({
      transport,
      capabilityGrant,
      subscriptionId: entry.subscriptionId,
      namespace: entry.namespace,
      onStatusChange: (status) => {
        if (!this.isCurrent(entry, client, generation)) {
          return
        }
        if (status.kind === 'synchronizing') {
          this.publish(
            entry,
            sshTerminalAuthorityTopologySynchronizingState(entry.authorityCommitted, status.reason)
          )
        } else if (status.kind === 'stale') {
          this.publish(
            entry,
            sshTerminalAuthorityTopologyStaleState(entry.authorityCommitted, status.error)
          )
        }
      },
      onAuthoritativeState: (snapshot) => {
        if (this.isCurrent(entry, client, generation)) {
          entry.authorityCommitted = true
          this.publish(entry, Object.freeze({ kind: 'authoritative', snapshot }))
        }
      }
    })
    entry.client = client
    try {
      await client.start()
    } catch (error) {
      if (this.isCurrent(entry, client, generation)) {
        throw error
      }
    }
  }

  private isCurrent(
    entry: NamespaceEntry,
    client: SshTerminalAuthorityTopologyClient,
    generation: number
  ): boolean {
    return (
      !this.disposed &&
      generation === this.connectionGeneration &&
      this.entries.get(namespaceKey(entry.namespace)) === entry &&
      entry.client === client
    )
  }

  private publish(entry: NamespaceEntry, state: SshTerminalAuthorityNamespaceTopologyState): void {
    entry.state = state
    for (const sink of entry.sinks.values()) {
      this.notifySink(sink, state)
    }
  }

  private commitAuthority(entry: NamespaceEntry): void {
    if (entry.authorityCommitted) {
      return
    }
    entry.authorityCommitted = true
    const committedState = commitSshTerminalAuthorityTopologyState(entry.state)
    if (committedState !== entry.state) {
      this.publish(entry, committedState)
    }
  }

  private notifySink(
    sink: SshTerminalAuthorityNamespaceTopologySink,
    state: SshTerminalAuthorityNamespaceTopologyState
  ): void {
    try {
      sink(state)
    } catch {
      // A projection observer cannot change authority synchronization.
    }
  }
}
