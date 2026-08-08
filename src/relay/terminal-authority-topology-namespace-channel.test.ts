import { describe, expect, it, vi } from 'vitest'
import type { TerminalAuthorityObserverAccess } from '../main/session-authority/terminal-session-authority-access'
import type { TerminalAuthorityProjectionChange } from '../main/session-authority/terminal-session-authority-service-contract'
import {
  SshTerminalAuthorityTopologyClient,
  type SshTerminalAuthorityTopologyClientStatus
} from '../main/ssh/ssh-terminal-authority-topology-client'
import type { SshTerminalAuthorityTopologyTransport } from '../main/ssh/ssh-terminal-authority-topology-client-contract'
import type {
  TerminalAuthorityProjection,
  TerminalPaneAuthorityProjection
} from '../shared/terminal-session-authority-mutation'
import type {
  TerminalAuthorityTopologyChange,
  TerminalAuthorityTopologySnapshot
} from '../shared/terminal-authority-topology-stream-contract'
import {
  type TerminalAuthorityTopologyChannelService,
  TerminalAuthorityTopologyNamespaceChannel
} from './terminal-authority-topology-namespace-channel'

const namespace = Object.freeze({ authorityHostId: 'host-1', namespaceId: 'namespace-1' })
const binding = Object.freeze({
  ownerIncarnationId: 'owner-1',
  physicalPtyId: 'pty-1',
  ptyIncarnationId: 'incarnation-1'
})

function pane(
  paneKey: string,
  paneGenerationId: string,
  revision: number,
  options: Partial<TerminalPaneAuthorityProjection> = {}
): TerminalPaneAuthorityProjection {
  const liveBinding = options.binding === undefined ? binding : options.binding
  return Object.freeze({
    paneKey,
    paneGenerationId,
    status: 'open',
    binding: liveBinding,
    lastBinding: liveBinding,
    revision,
    ownerStatus: liveBinding ? 'reachable' : null,
    ...options
  })
}

function projection(
  revision: number,
  panes: readonly TerminalPaneAuthorityProjection[],
  allocations: readonly unknown[] = []
): TerminalAuthorityProjection {
  return Object.freeze({
    namespace,
    writerEpoch: 1,
    revision,
    panes: Object.freeze([...panes]),
    allocations: Object.freeze(allocations) as TerminalAuthorityProjection['allocations']
  })
}

class FakeService implements TerminalAuthorityTopologyChannelService {
  readonly namespace = namespace
  readonly events: string[] = []
  private listener: ((change: TerminalAuthorityProjectionChange) => void) | null = null
  private current: TerminalAuthorityProjection

  constructor(initial: TerminalAuthorityProjection) {
    this.current = initial
  }

  subscribeProjection(
    actorId: string,
    listener: (change: TerminalAuthorityProjectionChange) => void
  ): TerminalAuthorityObserverAccess {
    this.events.push('subscribe')
    this.listener = listener
    return Object.freeze({
      role: 'observer',
      serviceInstanceId: 'service-1',
      accessId: 'observer-1',
      actorId
    })
  }

  revokeObserver(): void {
    this.events.push('revoke')
    this.listener = null
  }

  snapshotForObserver(): TerminalAuthorityProjection {
    this.events.push('snapshot')
    return this.current
  }

  publish(next: TerminalAuthorityProjection): void {
    this.current = next
    this.listener?.(Object.freeze({ reason: 'mutation', projection: next }))
  }
}

function harness(initial = projection(0, [])) {
  const service = new FakeService(initial)
  const changes: TerminalAuthorityTopologyChange[] = []
  const disconnect = vi.fn()
  const notificationHandlers = new Set<(params: Record<string, unknown>) => void>()
  let recoveryRevision = 0
  let clientSnapshotRequests = 0
  let channel: TerminalAuthorityTopologyNamespaceChannel
  const clientTransport: SshTerminalAuthorityTopologyTransport = {
    onNotificationByMethod: (_method, handler) => {
      notificationHandlers.add(handler)
      return () => notificationHandlers.delete(handler)
    },
    request: (_method, params) => {
      clientSnapshotRequests += 1
      return channel.captureSnapshot(String(params.subscriptionId))
    },
    notify: () => true
  }
  channel = new TerminalAuthorityTopologyNamespaceChannel(
    service,
    {
      recoveryNoticesForNamespace: () =>
        Object.freeze({ version: 1, revision: recoveryRevision, notices: Object.freeze([]) })
    },
    {
      notify: (_clientId, _method, change) => {
        changes.push(change)
        for (const handler of notificationHandlers) {
          handler(change as unknown as Record<string, unknown>)
        }
        return true
      },
      disconnect
    },
    (empty) => empty.dispose(),
    (error) => {
      throw error
    },
    (() => {
      let id = 0
      return () => `stream-${++id}`
    })()
  )
  return {
    service,
    channel,
    changes,
    disconnect,
    clientTransport,
    clientSnapshotRequests: () => clientSnapshotRequests,
    setRecoveryRevision: (revision: number) => {
      recoveryRevision = revision
    }
  }
}

describe('terminal authority topology namespace channel', () => {
  it('installs the service listener before capturing an allocation-free snapshot', async () => {
    const h = harness(projection(1, [pane('pane-1', 'generation-1', 1)], [{ secret: true }]))
    const subscription = h.channel.subscribe(7, 'subscription-1')

    const snapshot = await h.channel.captureSnapshot('subscription-1')

    expect(h.service.events.slice(0, 2)).toEqual(['subscribe', 'snapshot'])
    expect(snapshot.panes).toHaveLength(1)
    expect(JSON.stringify(snapshot)).not.toContain('allocations')
    expect(JSON.stringify(snapshot)).not.toContain('secret')
    subscription.dispose()
  })

  it('does no diff or transport work synchronously in the authority mutation callback', async () => {
    const h = harness()
    h.channel.subscribe(7, 'subscription-1')
    await h.channel.captureSnapshot('subscription-1')

    h.service.publish(projection(1, [pane('pane-1', 'generation-1', 1)]))
    expect(h.changes).toHaveLength(0)
    await h.channel.captureSnapshot('subscription-1')

    expect(h.changes).toHaveLength(1)
    expect(h.changes[0]).toMatchObject({
      baseAuthorityRevision: 0,
      authorityRevision: 1,
      changeSequence: 1
    })
  })

  it('keeps supersede changes atomic and an open unbound pane valid', async () => {
    const original = pane('pane-1', 'generation-1', 1)
    const h = harness(projection(1, [original]))
    h.channel.subscribe(7, 'subscription-1')
    await h.channel.captureSnapshot('subscription-1')
    const superseded = pane('pane-1', 'generation-1', 2, {
      status: 'superseded',
      binding: null,
      ownerStatus: null
    })
    const unbound = pane('pane-1', 'generation-2', 2, {
      binding: null,
      lastBinding: null,
      ownerStatus: null
    })

    h.service.publish(projection(2, [superseded, unbound]))
    await h.channel.captureSnapshot('subscription-1')

    expect(h.changes).toHaveLength(1)
    expect(h.changes[0].paneChanges).toHaveLength(2)
    expect(JSON.stringify(h.changes[0])).not.toContain('allocation')
    expect(JSON.stringify(h.changes[0])).not.toContain('spawn')
  })

  it('publishes derived owner status changes even at the same authority revision', async () => {
    const h = harness(projection(1, [pane('pane-1', 'generation-1', 1)]))
    h.channel.subscribe(7, 'subscription-1')
    await h.channel.captureSnapshot('subscription-1')

    h.service.publish(
      projection(1, [pane('pane-1', 'generation-1', 1, { ownerStatus: 'owner-unreachable' })])
    )
    await h.channel.captureSnapshot('subscription-1')

    expect(h.changes[0]).toMatchObject({
      baseAuthorityRevision: 1,
      authorityRevision: 1,
      paneChanges: [{ kind: 'upsert', pane: { ownerStatus: 'owner-unreachable' } }]
    })
  })

  it('forces an exact resnapshot instead of exposing a partial multi-batch revision', async () => {
    const h = harness()
    h.channel.subscribe(7, 'subscription-1')
    const authoritativeStates: TerminalAuthorityTopologySnapshot[] = []
    const statuses: SshTerminalAuthorityTopologyClientStatus[] = []
    const client = new SshTerminalAuthorityTopologyClient({
      transport: h.clientTransport,
      capabilityGrant: { version: 1 },
      subscriptionId: 'subscription-1',
      namespace,
      onStatusChange: (status) => statuses.push(status),
      onAuthoritativeState: (snapshot) => authoritativeStates.push(snapshot)
    })
    await client.start()
    const panes = Array.from({ length: 1_025 }, (_, index) =>
      pane(`pane-${index}`, `generation-${index}`, 2, {
        binding: null,
        lastBinding: null,
        ownerStatus: null
      })
    )

    h.service.publish(projection(2, panes))
    await h.channel.captureSnapshot('flush-subscription')
    await vi.waitFor(() => expect(client.authoritativeState()?.panes).toHaveLength(1_025))

    expect(h.changes).toHaveLength(1)
    expect(h.changes[0]).toMatchObject({
      changeSequence: 2,
      baseAuthorityRevision: 0,
      authorityRevision: 2
    })
    expect(h.changes[0].paneChanges).toHaveLength(1)
    expect(statuses).toContainEqual(
      expect.objectContaining({ kind: 'synchronizing', reason: 'sequence-gap' })
    )
    expect(h.clientSnapshotRequests()).toBe(2)
    expect(authoritativeStates.map((snapshot) => snapshot.panes.length)).toEqual([0, 1_025])
    client.dispose()
  })

  it('publishes namespace recovery revisions without inventing pane changes', async () => {
    const h = harness()
    h.channel.subscribe(7, 'subscription-1')
    await h.channel.captureSnapshot('subscription-1')
    h.setRecoveryRevision(3)

    h.service.publish(projection(0, []))
    await h.channel.captureSnapshot('subscription-1')

    expect(h.changes[0]).toMatchObject({
      paneChanges: [],
      namespaceRecoveryNotices: { revision: 3 }
    })
  })

  it('fences a writer-epoch change by disconnecting instead of continuing a lineage', async () => {
    const h = harness()
    h.channel.subscribe(7, 'subscription-1')
    await h.channel.captureSnapshot('subscription-1')
    const restarted = { ...projection(0, []), writerEpoch: 2 }

    h.service.publish(Object.freeze(restarted))
    await h.channel.captureSnapshot('subscription-1')

    expect(h.disconnect).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ message: 'terminal_authority_topology_writer_epoch_changed' })
    )
    expect(h.changes).toHaveLength(0)
  })
})
