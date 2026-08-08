import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalAuthorityTopologySnapshot } from '../../shared/terminal-authority-topology-stream-contract'
import {
  SSH_TERMINAL_AUTHORITY_TOPOLOGY_MAX_REQUESTS_PER_SYNCHRONIZATION,
  SshTerminalAuthorityTopologyClient
} from './ssh-terminal-authority-topology-client'
import type { SshTerminalAuthorityTopologyTransport } from './ssh-terminal-authority-topology-client-contract'

const namespace = Object.freeze({ authorityHostId: 'host-a', namespaceId: 'namespace-a' })

type PendingRequest = Readonly<{
  method: string
  params: Record<string, unknown>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  cleanup: () => void
}>

class FakeTopologyTransport implements SshTerminalAuthorityTopologyTransport {
  readonly events: string[] = []
  readonly pending: PendingRequest[] = []
  readonly notifications: { method: string; params: Record<string, unknown> }[] = []
  private notificationHandler: ((params: Record<string, unknown>) => void) | null = null

  onNotificationByMethod(
    method: string,
    handler: (params: Record<string, unknown>) => void
  ): () => void {
    this.events.push(`listen:${method}`)
    this.notificationHandler = handler
    return () => {
      if (this.notificationHandler === handler) {
        this.notificationHandler = null
      }
    }
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
        method,
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
    this.events.push(`notify:${method}`)
    this.notifications.push({ method, params })
    return true
  }

  emit(params: Record<string, unknown>): void {
    this.notificationHandler?.(params)
  }

  resolveNext(value: unknown, beforeResolution?: () => void): void {
    const request = this.pending.shift()
    if (!request) {
      throw new Error('No pending topology request')
    }
    request.cleanup()
    beforeResolution?.()
    request.resolve(value)
  }

  rejectNext(error: Error): void {
    const request = this.pending.shift()
    if (!request) {
      throw new Error('No pending topology request')
    }
    request.cleanup()
    request.reject(error)
  }

  hasNotificationHandler(): boolean {
    return this.notificationHandler !== null
  }
}

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: 1,
    subscriptionId: 'subscription-a',
    streamIncarnationId: 'stream-a',
    namespace,
    writerEpoch: 1,
    authorityRevision: 0,
    appliedChangeSequence: 0,
    panes: [],
    namespaceRecoveryNotices: { version: 1, revision: 0, notices: [] },
    ...overrides
  }
}

function change(
  sequence: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    protocolVersion: 1,
    subscriptionId: 'subscription-a',
    streamIncarnationId: 'stream-a',
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

function createClient(
  transport: FakeTopologyTransport,
  overrides: Partial<ConstructorParameters<typeof SshTerminalAuthorityTopologyClient>[0]> = {}
): SshTerminalAuthorityTopologyClient {
  return new SshTerminalAuthorityTopologyClient({
    transport,
    capabilityGrant: { version: 1 },
    subscriptionId: 'subscription-a',
    namespace,
    ...overrides
  })
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SSH terminal authority topology client startup', () => {
  it('installs its notification handler before issuing the initial snapshot request', async () => {
    const transport = new FakeTopologyTransport()
    const client = createClient(transport)
    const started = client.start()

    expect(transport.events).toEqual([
      'listen:terminalAuthority.topologyChanged',
      'request:terminalAuthority.topologySnapshot'
    ])
    expect(transport.pending[0]?.params).toEqual({
      protocolVersion: 1,
      subscriptionId: 'subscription-a',
      namespace
    })
    transport.resolveNext(snapshot())

    await expect(started).resolves.toMatchObject({ appliedChangeSequence: 0 })
    expect(client.status.kind).toBe('synchronized')
  })

  it('buffers and applies a contiguous change published before the snapshot response', async () => {
    const transport = new FakeTopologyTransport()
    const client = createClient(transport)
    const started = client.start()
    transport.emit(change(1))
    transport.resolveNext(snapshot())

    await expect(started).resolves.toMatchObject({
      appliedChangeSequence: 1,
      namespaceRecoveryNotices: { revision: 1 }
    })
    expect(transport.pending).toHaveLength(0)
  })

  it('requires an explicit v1 grant before installing any wire behavior', () => {
    const transport = new FakeTopologyTransport()
    expect(
      () =>
        new SshTerminalAuthorityTopologyClient({
          transport,
          capabilityGrant: { version: 2 } as never,
          subscriptionId: 'subscription-a',
          namespace
        })
    ).toThrow('capability_not_granted')
    expect(transport.events).toEqual([])
  })

  it('adds no deadline, polling, or liveness timer while awaiting authority', async () => {
    vi.useFakeTimers()
    const transport = new FakeTopologyTransport()
    const client = createClient(transport)
    const started = client.start()
    const cancelled = expect(started).rejects.toThrow('cancelled')

    expect(vi.getTimerCount()).toBe(0)
    client.dispose()
    await cancelled
  })
})

describe('SSH terminal authority topology client resnapshot', () => {
  it('makes a gap non-authoritative until an exact replacement snapshot arrives', async () => {
    const transport = new FakeTopologyTransport()
    const states: TerminalAuthorityTopologySnapshot[] = []
    const client = createClient(transport, { onAuthoritativeState: (state) => states.push(state) })
    const started = client.start()
    transport.resolveNext(snapshot())
    await started

    transport.emit(change(2))

    expect(client.status).toMatchObject({ kind: 'synchronizing', reason: 'sequence-gap' })
    expect(client.authoritativeState()).toBeNull()
    expect(client.lastKnownState()?.appliedChangeSequence).toBe(0)
    expect(transport.pending).toHaveLength(1)
    transport.resolveNext(
      snapshot({
        authorityRevision: 2,
        appliedChangeSequence: 2,
        namespaceRecoveryNotices: { version: 1, revision: 2, notices: [] }
      })
    )
    await settle()

    expect(client.authoritativeState()).toMatchObject({
      authorityRevision: 2,
      appliedChangeSequence: 2
    })
    expect(states).toHaveLength(2)
  })

  it('resnapshots a changed stream incarnation instead of classifying terminals dead', async () => {
    const transport = new FakeTopologyTransport()
    const client = createClient(transport)
    const started = client.start()
    transport.resolveNext(snapshot())
    await started

    transport.emit(change(1, { streamIncarnationId: 'stream-b' }))

    expect(client.authoritativeState()).toBeNull()
    expect(client.lastKnownState()?.streamIncarnationId).toBe('stream-a')
    expect(transport.pending).toHaveLength(1)
    transport.resolveNext(snapshot({ streamIncarnationId: 'stream-b' }))
    await settle()
    expect(client.authoritativeState()?.streamIncarnationId).toBe('stream-b')
  })

  it('does not authorize a regressed snapshot from the current stream', async () => {
    const transport = new FakeTopologyTransport()
    const client = createClient(transport)
    const started = client.start()
    transport.resolveNext(
      snapshot({
        authorityRevision: 2,
        appliedChangeSequence: 2,
        namespaceRecoveryNotices: { version: 1, revision: 2, notices: [] }
      })
    )
    await started
    const resnapshot = client.resnapshot()
    transport.resolveNext(
      snapshot({
        authorityRevision: 1,
        appliedChangeSequence: 1,
        namespaceRecoveryNotices: { version: 1, revision: 1, notices: [] }
      })
    )
    await settle()

    expect(client.authoritativeState()).toBeNull()
    expect(client.lastKnownState()).toMatchObject({
      authorityRevision: 2,
      appliedChangeSequence: 2
    })
    expect(transport.pending).toHaveLength(1)
    transport.resolveNext(
      snapshot({
        authorityRevision: 2,
        appliedChangeSequence: 2,
        namespaceRecoveryNotices: { version: 1, revision: 2, notices: [] }
      })
    )
    await expect(resnapshot).resolves.toMatchObject({ authorityRevision: 2 })
  })

  it('resnapshots an ambiguously ordered different-stream notification', async () => {
    const transport = new FakeTopologyTransport()
    const client = createClient(transport)
    const started = client.start()
    transport.resolveNext(snapshot())
    await started
    const resnapshot = client.resnapshot()

    transport.emit(change(1, { streamIncarnationId: 'stream-a' }))
    transport.resolveNext(snapshot({ streamIncarnationId: 'stream-b' }))
    await settle()

    expect(transport.pending).toHaveLength(1)
    transport.resolveNext(snapshot({ streamIncarnationId: 'stream-b' }))
    await expect(resnapshot).resolves.toMatchObject({ streamIncarnationId: 'stream-b' })
  })

  it('discards a different stream only when a higher writer epoch fences it', async () => {
    const transport = new FakeTopologyTransport()
    const client = createClient(transport)
    const started = client.start()
    transport.resolveNext(snapshot({ writerEpoch: 2 }))
    await started
    const resnapshot = client.resnapshot()

    transport.emit(change(1, { streamIncarnationId: 'old-stream', writerEpoch: 1 }))
    transport.resolveNext(snapshot({ streamIncarnationId: 'stream-b', writerEpoch: 2 }))

    await expect(resnapshot).resolves.toMatchObject({ streamIncarnationId: 'stream-b' })
    expect(transport.pending).toHaveLength(0)
  })

  it('discards a live different-stream notification fenced by an older writer epoch', async () => {
    const transport = new FakeTopologyTransport()
    const client = createClient(transport)
    const started = client.start()
    transport.resolveNext(snapshot({ writerEpoch: 2 }))
    await started

    transport.emit(change(1, { streamIncarnationId: 'old-stream', writerEpoch: 1 }))

    expect(client.status.kind).toBe('synchronized')
    expect(client.authoritativeState()).toMatchObject({
      streamIncarnationId: 'stream-a',
      writerEpoch: 2,
      appliedChangeSequence: 0
    })
    expect(transport.pending).toHaveLength(0)
  })

  it('resnapshots a changed stream received while snapshot settlement is pending', async () => {
    const transport = new FakeTopologyTransport()
    const client = createClient(transport)
    const started = client.start()
    transport.resolveNext(snapshot())
    await started
    const resnapshot = client.resnapshot()

    transport.resolveNext(snapshot({ streamIncarnationId: 'stream-b' }), () => {
      transport.emit(change(1, { streamIncarnationId: 'stream-c' }))
    })
    await settle()
    expect(transport.pending).toHaveLength(1)
    transport.resolveNext(snapshot({ streamIncarnationId: 'stream-c' }))

    await expect(resnapshot).resolves.toMatchObject({ streamIncarnationId: 'stream-c' })
  })

  it('resnapshots malformed relevant notifications without applying them', async () => {
    const transport = new FakeTopologyTransport()
    const client = createClient(transport)
    const started = client.start()
    transport.resolveNext(snapshot())
    await started

    transport.emit({ subscriptionId: 'subscription-a', protocolVersion: 99 })

    expect(client.authoritativeState()).toBeNull()
    expect(transport.pending).toHaveLength(1)
    transport.resolveNext(snapshot())
    await settle()
    expect(client.authoritativeState()?.appliedChangeSequence).toBe(0)
  })

  it('bounds snapshot-settlement buffering and resolves it only through another snapshot', async () => {
    const transport = new FakeTopologyTransport()
    const client = createClient(transport)
    const started = client.start()
    transport.resolveNext(snapshot(), () => {
      for (let sequence = 1; sequence <= 257; sequence += 1) {
        transport.emit(change(sequence))
      }
    })
    await settle()

    expect(transport.pending).toHaveLength(1)
    transport.resolveNext(
      snapshot({
        appliedChangeSequence: 257,
        namespaceRecoveryNotices: { version: 1, revision: 257, notices: [] }
      })
    )
    await expect(started).resolves.toMatchObject({ appliedChangeSequence: 257 })
  })

  it('stops requesting after bounded continuous snapshot-settlement churn', async () => {
    const transport = new FakeTopologyTransport()
    const client = createClient(transport)
    const started = client.start()
    const capacityFailure = expect(started).rejects.toThrow('resnapshot_attempt_capacity')

    for (
      let request = 0;
      request < SSH_TERMINAL_AUTHORITY_TOPOLOGY_MAX_REQUESTS_PER_SYNCHRONIZATION;
      request += 1
    ) {
      transport.resolveNext(snapshot({ streamIncarnationId: `snapshot-stream-${request}` }), () => {
        transport.emit(change(1, { streamIncarnationId: `later-stream-${request}` }))
      })
      await settle()
    }

    await capacityFailure
    expect(client.status).toMatchObject({ kind: 'stale' })
    expect(
      transport.events.filter((event) => event === 'request:terminalAuthority.topologySnapshot')
    ).toHaveLength(SSH_TERMINAL_AUTHORITY_TOPOLOGY_MAX_REQUESTS_PER_SYNCHRONIZATION)
    expect(transport.pending).toHaveLength(0)

    const explicitRetry = client.resnapshot()
    transport.resolveNext(snapshot({ streamIncarnationId: 'stable-stream' }))
    await expect(explicitRetry).resolves.toMatchObject({ streamIncarnationId: 'stable-stream' })
  })

  it('retains but does not authorize the last snapshot after resnapshot failure', async () => {
    const transport = new FakeTopologyTransport()
    const errors: Error[] = []
    const client = createClient(transport, {
      onSynchronizationError: (error) => errors.push(error)
    })
    const started = client.start()
    transport.resolveNext(snapshot())
    await started

    transport.emit(change(2))
    transport.rejectNext(new Error('connection unavailable'))
    await settle()

    expect(client.status).toMatchObject({ kind: 'stale' })
    expect(client.authoritativeState()).toBeNull()
    expect(client.lastKnownState()?.appliedChangeSequence).toBe(0)
    expect(errors).toHaveLength(1)
    expect(transport.pending).toHaveLength(0)
  })

  it('unsubscribes the stable server subscription and local handler on detach', async () => {
    const transport = new FakeTopologyTransport()
    const client = createClient(transport)
    const started = client.start()
    transport.resolveNext(snapshot())
    await started

    client.dispose()
    transport.emit(change(2))

    expect(transport.notifications).toEqual([
      {
        method: 'terminalAuthority.topologyUnsubscribe',
        params: { protocolVersion: 1, subscriptionId: 'subscription-a', namespace }
      }
    ])
    expect(transport.hasNotificationHandler()).toBe(false)
    expect(transport.pending).toHaveLength(0)
  })

  it('cancels an in-flight snapshot and still unsubscribes on detach', async () => {
    const transport = new FakeTopologyTransport()
    const client = createClient(transport)
    const started = client.start()
    const cancelled = expect(started).rejects.toThrow('cancelled')

    client.dispose()

    await cancelled
    expect(transport.pending).toHaveLength(0)
    expect(transport.hasNotificationHandler()).toBe(false)
    expect(transport.notifications[0]?.method).toBe('terminalAuthority.topologyUnsubscribe')
  })
})
