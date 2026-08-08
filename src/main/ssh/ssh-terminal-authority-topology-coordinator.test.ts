import { describe, expect, it, vi } from 'vitest'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import {
  SshTerminalAuthorityTopologyCoordinator,
  type SshTerminalAuthorityNamespaceTopologyState
} from './ssh-terminal-authority-topology-coordinator'

type PendingRequest = {
  params: Record<string, unknown>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  cleanup: () => void
}

class FakeTopologyTransport {
  readonly events: string[] = []
  readonly pending: PendingRequest[] = []
  readonly notifications: { method: string; params: Record<string, unknown> }[] = []
  private readonly handlers = new Set<(params: Record<string, unknown>) => void>()

  onNotificationByMethod(
    method: string,
    handler: (params: Record<string, unknown>) => void
  ): () => void {
    this.events.push(`listen:${method}`)
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  request(
    method: string,
    params: Record<string, unknown>,
    options: Readonly<{ signal: AbortSignal }>
  ): Promise<unknown> {
    this.events.push(`request:${method}`)
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const index = this.pending.indexOf(pending)
        if (index >= 0) {
          this.pending.splice(index, 1)
        }
        reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
      }
      const pending: PendingRequest = {
        params,
        resolve,
        reject,
        cleanup: () => options.signal.removeEventListener('abort', onAbort)
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
      this.pending.push(pending)
    })
  }

  notify(method: string, params: Record<string, unknown>): boolean {
    this.notifications.push({ method, params })
    return true
  }

  emit(params: Record<string, unknown>): void {
    for (const handler of Array.from(this.handlers)) {
      handler(params)
    }
  }

  resolveAt(index: number, overrides: Record<string, unknown> = {}): void {
    const pending = this.pending.splice(index, 1)[0]
    if (!pending) {
      throw new Error('No pending topology request')
    }
    pending.cleanup()
    const namespace = pending.params.namespace as TerminalAuthorityNamespace
    pending.resolve({
      protocolVersion: 1,
      subscriptionId: pending.params.subscriptionId,
      streamIncarnationId: `stream-${namespace.namespaceId}`,
      namespace,
      writerEpoch: 1,
      authorityRevision: 0,
      appliedChangeSequence: 0,
      panes: [],
      namespaceRecoveryNotices: { version: 1, revision: 0, notices: [] },
      ...overrides
    })
  }

  rejectAt(index: number, error: Error): void {
    const pending = this.pending.splice(index, 1)[0]
    if (!pending) {
      throw new Error('No pending topology request')
    }
    pending.cleanup()
    pending.reject(error)
  }

  handlerCount(): number {
    return this.handlers.size
  }
}

const grant = Object.freeze({ version: 1 as const })
const namespaceA = Object.freeze({ authorityHostId: 'host-a', namespaceId: 'namespace-a' })
const namespaceB = Object.freeze({ authorityHostId: 'host-a', namespaceId: 'namespace-b' })

function asMux(transport: FakeTopologyTransport): SshChannelMultiplexer {
  return transport as unknown as SshChannelMultiplexer
}

function change(
  request: Pick<PendingRequest, 'params'>,
  sequence: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const namespace = request.params.namespace as TerminalAuthorityNamespace
  return {
    protocolVersion: 1,
    subscriptionId: request.params.subscriptionId,
    streamIncarnationId: `stream-${namespace.namespaceId}`,
    namespace,
    writerEpoch: 1,
    baseAuthorityRevision: 0,
    authorityRevision: 0,
    changeSequence: sequence,
    paneChanges: [],
    namespaceRecoveryNotices: { version: 1, revision: sequence, notices: [] },
    ...overrides
  }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('SshTerminalAuthorityTopologyCoordinator', () => {
  it('keeps old-host behavior when the optional capability is not granted', async () => {
    const coordinator = new SshTerminalAuthorityTopologyCoordinator()
    const transport = new FakeTopologyTransport()
    const states: SshTerminalAuthorityNamespaceTopologyState[] = []
    coordinator.attachResolvedNamespace(namespaceA, (state) => states.push(state))

    await coordinator.onTopologyCapability(asMux(transport), null)

    expect(states.map((state) => state.kind)).toEqual(['disconnected', 'legacy-fallback'])
    expect(transport.events).toEqual([])
    coordinator.dispose()
  })

  it('starts a namespace attached after capability admission', async () => {
    const coordinator = new SshTerminalAuthorityTopologyCoordinator()
    const transport = new FakeTopologyTransport()
    const states: SshTerminalAuthorityNamespaceTopologyState[] = []
    await coordinator.onTopologyCapability(asMux(transport), grant)

    coordinator.attachResolvedNamespace(namespaceA, (state) => states.push(state))

    expect(transport.events).toEqual([
      'listen:terminalAuthority.topologyChanged',
      'request:terminalAuthority.topologySnapshot'
    ])
    expect(states.at(-1)?.kind).toBe('synchronizing')
    transport.resolveAt(0)
    await settle()
    expect(states.at(-1)?.kind).toBe('authoritative')
    coordinator.dispose()
  })

  it('deduplicates a namespace and keeps its subscription until the final observer detaches', async () => {
    const coordinator = new SshTerminalAuthorityTopologyCoordinator()
    const transport = new FakeTopologyTransport()
    const first: SshTerminalAuthorityNamespaceTopologyState[] = []
    const second: SshTerminalAuthorityNamespaceTopologyState[] = []
    const detachFirst = coordinator.attachResolvedNamespace(namespaceA, (state) =>
      first.push(state)
    )
    const detachSecond = coordinator.attachResolvedNamespace(namespaceA, (state) =>
      second.push(state)
    )
    const synchronized = coordinator.onTopologyCapability(asMux(transport), grant)

    expect(transport.events).toEqual([
      'listen:terminalAuthority.topologyChanged',
      'request:terminalAuthority.topologySnapshot'
    ])
    transport.resolveAt(0)
    await synchronized
    expect(first.at(-1)?.kind).toBe('authoritative')
    expect(second.at(-1)?.kind).toBe('authoritative')

    detachFirst()
    expect(transport.notifications).toHaveLength(0)
    const secondCount = second.length
    const request = {
      params: {
        subscriptionId: (
          second.at(-1) as Extract<
            SshTerminalAuthorityNamespaceTopologyState,
            { kind: 'authoritative' }
          >
        ).snapshot.subscriptionId,
        namespace: namespaceA
      }
    }
    transport.emit(change(request, 1))
    expect(first.at(-1)?.kind).toBe('authoritative')
    expect(second).toHaveLength(secondCount + 1)

    detachSecond()
    expect(transport.notifications).toHaveLength(1)
    expect(transport.notifications[0]?.method).toBe('terminalAuthority.topologyUnsubscribe')
    expect(transport.handlerCount()).toBe(0)
  })

  it('subscribes once per exact namespace and isolates their projections', async () => {
    const coordinator = new SshTerminalAuthorityTopologyCoordinator()
    const transport = new FakeTopologyTransport()
    const statesA: SshTerminalAuthorityNamespaceTopologyState[] = []
    const statesB: SshTerminalAuthorityNamespaceTopologyState[] = []
    coordinator.attachResolvedNamespace(namespaceA, (state) => statesA.push(state))
    coordinator.attachResolvedNamespace(namespaceB, (state) => statesB.push(state))
    const synchronized = coordinator.onTopologyCapability(asMux(transport), grant)

    expect(transport.pending.map((pending) => pending.params.namespace)).toEqual([
      namespaceA,
      namespaceB
    ])
    transport.resolveAt(1)
    transport.resolveAt(0)
    await synchronized

    expect(
      (
        statesA.at(-1) as Extract<
          SshTerminalAuthorityNamespaceTopologyState,
          { kind: 'authoritative' }
        >
      ).snapshot.namespace
    ).toEqual(namespaceA)
    expect(
      (
        statesB.at(-1) as Extract<
          SshTerminalAuthorityNamespaceTopologyState,
          { kind: 'authoritative' }
        >
      ).snapshot.namespace
    ).toEqual(namespaceB)
    coordinator.dispose()
  })

  it('makes a sequence gap non-authoritative until the exact resnapshot settles', async () => {
    const coordinator = new SshTerminalAuthorityTopologyCoordinator()
    const transport = new FakeTopologyTransport()
    const states: SshTerminalAuthorityNamespaceTopologyState[] = []
    coordinator.attachResolvedNamespace(namespaceA, (state) => states.push(state))
    const synchronized = coordinator.onTopologyCapability(asMux(transport), grant)
    const firstRequest = transport.pending[0]
    transport.resolveAt(0)
    await synchronized

    transport.emit(change(firstRequest, 2))
    expect(states.at(-1)).toMatchObject({
      kind: 'authority-unavailable',
      reason: 'synchronizing',
      synchronizationReason: 'sequence-gap'
    })
    expect(transport.pending).toHaveLength(1)
    transport.resolveAt(0, {
      authorityRevision: 2,
      appliedChangeSequence: 2,
      namespaceRecoveryNotices: { version: 1, revision: 2, notices: [] }
    })
    await settle()

    expect(states.at(-1)).toMatchObject({
      kind: 'authoritative',
      snapshot: { authorityRevision: 2, appliedChangeSequence: 2 }
    })
    coordinator.dispose()
  })

  it('fences late snapshots from a replaced reconnect generation', async () => {
    const coordinator = new SshTerminalAuthorityTopologyCoordinator()
    const oldTransport = new FakeTopologyTransport()
    const newTransport = new FakeTopologyTransport()
    const states: SshTerminalAuthorityNamespaceTopologyState[] = []
    coordinator.attachResolvedNamespace(namespaceA, (state) => states.push(state))
    const oldSynchronization = coordinator.onTopologyCapability(asMux(oldTransport), grant)

    const newSynchronization = coordinator.onTopologyCapability(asMux(newTransport), grant)
    await oldSynchronization
    expect(oldTransport.pending).toHaveLength(0)
    expect(oldTransport.handlerCount()).toBe(0)
    newTransport.resolveAt(0, { streamIncarnationId: 'winning-stream', writerEpoch: 2 })
    await newSynchronization

    expect(states.at(-1)).toMatchObject({
      kind: 'authoritative',
      snapshot: { streamIncarnationId: 'winning-stream', writerEpoch: 2 }
    })
    expect(oldTransport.notifications[0]?.method).toBe('terminalAuthority.topologyUnsubscribe')
    coordinator.dispose()
  })

  it('resnapshots retained namespaces after transport reconnect with stable subscription IDs', async () => {
    const coordinator = new SshTerminalAuthorityTopologyCoordinator()
    const firstTransport = new FakeTopologyTransport()
    const secondTransport = new FakeTopologyTransport()
    const states: SshTerminalAuthorityNamespaceTopologyState[] = []
    coordinator.attachResolvedNamespace(namespaceA, (state) => states.push(state))
    const firstSynchronization = coordinator.onTopologyCapability(asMux(firstTransport), grant)
    const firstSubscriptionId = firstTransport.pending[0]?.params.subscriptionId
    firstTransport.resolveAt(0)
    await firstSynchronization

    coordinator.detachTransport(asMux(firstTransport))
    expect(states.at(-1)).toMatchObject({
      kind: 'authority-unavailable',
      reason: 'disconnected'
    })
    const secondSynchronization = coordinator.onTopologyCapability(asMux(secondTransport), grant)
    expect(secondTransport.pending[0]?.params.subscriptionId).toBe(firstSubscriptionId)
    secondTransport.resolveAt(0, { writerEpoch: 2, streamIncarnationId: 'new-stream' })
    await secondSynchronization

    expect(states.at(-1)).toMatchObject({
      kind: 'authoritative',
      snapshot: { writerEpoch: 2, streamIncarnationId: 'new-stream' }
    })
    coordinator.dispose()
  })

  it('never resumes legacy fallback after reconnecting a committed namespace to an old host', async () => {
    const coordinator = new SshTerminalAuthorityTopologyCoordinator()
    const currentTransport = new FakeTopologyTransport()
    const oldHostTransport = new FakeTopologyTransport()
    const states: SshTerminalAuthorityNamespaceTopologyState[] = []
    coordinator.attachResolvedNamespace(namespaceA, (state) => states.push(state))
    const synchronized = coordinator.onTopologyCapability(asMux(currentTransport), grant)
    currentTransport.resolveAt(0)
    await synchronized

    coordinator.detachTransport(asMux(currentTransport))
    await coordinator.onTopologyCapability(asMux(oldHostTransport), null)

    const committedIndex = states.findIndex((state) => state.kind === 'authoritative')
    expect(states.slice(committedIndex + 1)).toEqual([
      { kind: 'authority-unavailable', reason: 'disconnected' },
      { kind: 'authority-unavailable', reason: 'capability-not-granted' }
    ])
    expect(oldHostTransport.events).toEqual([])
    coordinator.dispose()
  })

  it('retains committed cutover when the final sink detaches and a new sink mounts', async () => {
    const coordinator = new SshTerminalAuthorityTopologyCoordinator()
    const transport = new FakeTopologyTransport()
    const firstStates: SshTerminalAuthorityNamespaceTopologyState[] = []
    const detach = coordinator.attachResolvedNamespace(namespaceA, (state) =>
      firstStates.push(state)
    )
    const synchronized = coordinator.onTopologyCapability(asMux(transport), grant)
    const subscriptionId = transport.pending[0]?.params.subscriptionId
    transport.resolveAt(0)
    await synchronized
    detach()

    const remountedStates: SshTerminalAuthorityNamespaceTopologyState[] = []
    coordinator.attachResolvedNamespace(namespaceA, (state) => remountedStates.push(state))

    expect(remountedStates[0]).toMatchObject({
      kind: 'authority-unavailable',
      reason: 'synchronizing'
    })
    expect(transport.pending[0]?.params.subscriptionId).toBe(subscriptionId)
    transport.resolveAt(0, { writerEpoch: 2, streamIncarnationId: 'remounted-stream' })
    await settle()
    expect(remountedStates.at(-1)?.kind).toBe('authoritative')
    expect(remountedStates.some((state) => state.kind === 'legacy-fallback')).toBe(false)
    coordinator.dispose()
  })

  it('starts a durably committed namespace read-only when no topology grant exists', async () => {
    const coordinator = new SshTerminalAuthorityTopologyCoordinator()
    const transport = new FakeTopologyTransport()
    const states: SshTerminalAuthorityNamespaceTopologyState[] = []
    coordinator.attachResolvedNamespace(namespaceA, (state) => states.push(state), {
      durableCutoverCommitted: true
    })

    await coordinator.onTopologyCapability(asMux(transport), null)

    expect(states).toEqual([
      { kind: 'authority-unavailable', reason: 'disconnected' },
      { kind: 'authority-unavailable', reason: 'capability-not-granted' }
    ])
    expect(transport.events).toEqual([])
    coordinator.dispose()
  })

  it('keeps a committed namespace read-only after synchronization becomes stale', async () => {
    const coordinator = new SshTerminalAuthorityTopologyCoordinator()
    const transport = new FakeTopologyTransport()
    const states: SshTerminalAuthorityNamespaceTopologyState[] = []
    coordinator.attachResolvedNamespace(namespaceA, (state) => states.push(state))
    const synchronized = coordinator.onTopologyCapability(asMux(transport), grant)
    const request = transport.pending[0]
    transport.resolveAt(0)
    await synchronized

    transport.emit(change(request, 2))
    transport.rejectAt(0, new Error('snapshot failed'))
    await settle()

    expect(states.at(-1)).toMatchObject({
      kind: 'authority-unavailable',
      reason: 'stale',
      error: { message: 'snapshot failed' }
    })
    coordinator.dispose()
  })

  it('removes stale observers and isolates observer exceptions', async () => {
    const coordinator = new SshTerminalAuthorityTopologyCoordinator()
    const transport = new FakeTopologyTransport()
    const staleObserver = vi.fn()
    const liveObserver = vi.fn()
    const detach = coordinator.attachResolvedNamespace(namespaceA, staleObserver)
    coordinator.attachResolvedNamespace(namespaceA, () => {
      liveObserver()
      throw new Error('observer failed')
    })
    detach()
    const synchronized = coordinator.onTopologyCapability(asMux(transport), grant)
    transport.resolveAt(0)
    await synchronized

    expect(staleObserver).toHaveBeenCalledTimes(1)
    expect(liveObserver).toHaveBeenCalledTimes(3)
    coordinator.dispose()
  })

  it('bounds unique namespace subscriptions per connection', () => {
    const coordinator = new SshTerminalAuthorityTopologyCoordinator()
    for (let index = 0; index < 256; index += 1) {
      coordinator.attachResolvedNamespace(
        { authorityHostId: 'host-a', namespaceId: `namespace-${index}` },
        () => {}
      )
    }

    expect(() =>
      coordinator.attachResolvedNamespace(
        { authorityHostId: 'host-a', namespaceId: 'namespace-overflow' },
        () => {}
      )
    ).toThrow('subscription_capacity')
    coordinator.dispose()
  })

  it('bounds committed tombstones without evicting their fail-closed state', () => {
    const coordinator = new SshTerminalAuthorityTopologyCoordinator()
    for (let index = 0; index < 256; index += 1) {
      const detach = coordinator.attachResolvedNamespace(
        { authorityHostId: 'host-a', namespaceId: `committed-${index}` },
        () => {},
        { durableCutoverCommitted: true }
      )
      detach()
    }

    expect(() =>
      coordinator.attachResolvedNamespace(
        { authorityHostId: 'host-a', namespaceId: 'committed-overflow' },
        () => {}
      )
    ).toThrow('subscription_capacity')
    coordinator.dispose()
  })
})
