import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TerminalAuthorityNamespaceBoundaryAcceptance,
  TerminalAuthorityNamespaceOutcomeAck,
  TerminalAuthorityNamespaceOutcomeBoundary
} from '../../shared/terminal-session-authority-consumer-transport'
import type { TerminalAuthorityNamespaceAdmissionGrant } from '../../shared/terminal-session-authority-consumer-proof'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { TerminalAuthorityPolicyOutcomeTransport } from './terminal-session-authority-policy-consumers'
import {
  APP_CONSUMER,
  NAMESPACE,
  NEXT_APP_CONSUMER,
  authorityProjection,
  boundary,
  semanticPublication
} from './__tests__/terminal-authority-app-projection-fixture'
import {
  TerminalAuthorityAppOutcomeHostManager,
  type TerminalAuthorityAppOutcomeHostRegistration
} from './terminal-authority-app-outcome-host-manager'
import type {
  TerminalAuthorityAppNamespaceAdmissionRequest,
  TerminalAuthorityAppOutcomeHostTransport,
  TerminalAuthorityAppOutcomeManagerOptions
} from './terminal-authority-app-outcome-host-contract'
import { TerminalAuthorityAppProjectionStore } from './terminal-authority-app-projection-store'
import { terminalSessionAuthorityBoundaryId } from '../../shared/terminal-session-authority-boundary-identity'

const directories: string[] = []

type LegacyPumpOptions = TerminalAuthorityAppOutcomeManagerOptions &
  Readonly<{ host: TerminalAuthorityAppOutcomeHostTransport }>

class TerminalAuthorityAppOutcomeNamespaceHarness {
  private manager: TerminalAuthorityAppOutcomeHostManager | null = null
  private registration: TerminalAuthorityAppOutcomeHostRegistration | null = null

  constructor(private readonly options: LegacyPumpOptions) {}

  async start(
    _identity: typeof APP_CONSUMER,
    options: Readonly<{ namespace?: TerminalAuthorityNamespace }> = {}
  ): Promise<void> {
    const { host, ...managerOptions } = this.options
    this.manager = new TerminalAuthorityAppOutcomeHostManager(
      APP_CONSUMER.consumerIncarnationId,
      managerOptions
    )
    this.registration = this.manager.installHost(host)
    await this.registration.admitNamespace(options.namespace ?? NAMESPACE)
  }

  admitNamespace(namespace: TerminalAuthorityNamespace): Promise<void> {
    if (!this.registration) {
      throw new Error('test app outcome pump is unavailable')
    }
    return this.registration.admitNamespace(namespace)
  }

  dispose(): void {
    this.manager?.dispose()
    this.manager = null
    this.registration = null
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('TerminalAuthorityAppOutcomeNamespaceSession', () => {
  it('accepts the exact boundary only after its SQLite projection commits', async () => {
    const store = await memoryStore()
    const order: string[] = []
    const beginBoundary = store.beginBoundary.bind(store)
    vi.spyOn(store, 'beginBoundary').mockImplementation((value) => {
      const change = beginBoundary(value)
      order.push('commit')
      return change
    })
    const host = hostHarness([boundary(7)], undefined, {
      acceptBoundary: async () => {
        order.push('accept')
      }
    })
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => order.push('observe')
    })

    await pump.start(APP_CONSUMER)

    expect(host.connect.mock.calls[0]?.[0]).not.toHaveProperty('consumer')
    expect(order).toEqual(['commit', 'observe', 'accept'])
    expect(host.acceptBoundary).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        consumer: APP_CONSUMER,
        acknowledgedSequence: 7,
        outcomeHighWatermark: 7,
        boundaryId: expect.stringMatching(/^authority-boundary:/)
      })
    )
    pump.dispose()
    store.close()
  })

  it('replays a committed boundary after the host accepted but its response was lost', async () => {
    const store = await memoryStore()
    let attempts = 0
    const host = hostHarness([boundary(5)], undefined, {
      acceptBoundary: async () => {
        attempts += 1
        if (attempts === 1) {
          throw new Error('boundary acceptance response lost')
        }
      }
    })
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {},
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1
    })

    await pump.start(APP_CONSUMER)

    expect(host.connect).toHaveBeenCalledTimes(2)
    expect(host.acceptBoundary).toHaveBeenCalledTimes(2)
    expect(store.statistics()).toEqual({ rows: 1, writeTransactions: 1, writtenRows: 1 })
    pump.dispose()
    store.close()
  })

  it('rejects a projection tampered under an authenticated boundary identity', async () => {
    const store = await memoryStore()
    const authenticated = boundary(0)
    const host = hostHarness(
      [{ ...authenticated, projection: authorityProjection({ revision: 2 }) }],
      undefined,
      { preserveBoundaryId: true }
    )
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {}
    })

    await expect(pump.start(APP_CONSUMER)).rejects.toThrow('boundary identity is invalid')

    expect(host.acceptBoundary).not.toHaveBeenCalled()
    expect(store.snapshot(APP_CONSUMER.consumerId)).toEqual([])
    store.close()
  })

  it('commits before cumulative host ACK and ignores an unavailable renderer', async () => {
    const store = await memoryStore()
    const order: string[] = []
    const apply = store.apply.bind(store)
    vi.spyOn(store, 'apply').mockImplementation((publication) => {
      const result = apply(publication)
      order.push('commit')
      return result
    })
    const host = hostHarness([boundary(0)], async () => {
      order.push('ack')
      return 1
    })
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {
        order.push('observe')
        throw new Error('renderer unavailable')
      }
    })
    await pump.start(APP_CONSUMER)

    await host.publish(semanticPublication(1))

    expect(order).toEqual(['observe', 'commit', 'observe', 'ack'])
    expect(store.snapshot(APP_CONSUMER.consumerId)[0]?.facts.bell).toBeDefined()
    pump.dispose()
    store.close()
  })

  it('resnapshots and replays a lost ACK as a durable no-op', async () => {
    const store = await memoryStore()
    let cursor = 0
    let attemptedAck = false
    const projections = vi.fn()
    const publication = semanticPublication(1)
    const host = hostHarness(
      () => [
        boundary(cursor, {
          outcomeHighWatermark: attemptedAck ? 1 : cursor,
          projection: authorityProjection({
            materializedOutcomes: attemptedAck ? [publication.outcome] : []
          })
        })
      ],
      async (ack) => {
        if (!attemptedAck) {
          attemptedAck = true
          throw new Error('ACK lost')
        }
        cursor = ack.sequence
        return cursor
      }
    )
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: projections
    })
    await pump.start(APP_CONSUMER)

    await expect(host.publish(publication)).rejects.toThrow('ACK lost')
    await vi.waitFor(() => expect(host.acceptBoundary).toHaveBeenCalledTimes(2))
    await host.publish(publication)

    expect(cursor).toBe(1)
    expect(projections).toHaveBeenCalledTimes(2)
    expect(store.statistics()).toEqual({ rows: 1, writeTransactions: 2, writtenRows: 2 })
    pump.dispose()
    store.close()
  })

  it('holds a gap without ACK and reconnects for an authenticated boundary', async () => {
    const store = await memoryStore()
    const host = hostHarness([boundary(0)])
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {}
    })
    await pump.start(APP_CONSUMER)

    await expect(host.publish(semanticPublication(2))).rejects.toThrow('cursor gap')
    await vi.waitFor(() => expect(host.connect).toHaveBeenCalledTimes(2))

    expect(host.acknowledge).not.toHaveBeenCalled()
    expect(store.snapshot(APP_CONSUMER.consumerId)[0]?.facts).toEqual({})
    pump.dispose()
    store.close()
  })

  it('rejects a wrong consumer incarnation before projection or ACK', async () => {
    const store = await memoryStore()
    const host = hostHarness([boundary(0)])
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {}
    })
    await pump.start(APP_CONSUMER)

    await expect(
      host.publish(semanticPublication(1, { kind: 'bell' }, { consumer: NEXT_APP_CONSUMER }))
    ).rejects.toThrow('consumer incarnation changed')

    expect(host.acknowledge).not.toHaveBeenCalled()
    expect(store.snapshot(APP_CONSUMER.consumerId)[0]?.facts).toEqual({})
    pump.dispose()
    store.close()
  })

  it.each([
    {
      label: 'process incarnation',
      grant: (value: TerminalAuthorityNamespaceAdmissionGrant) =>
        Object.freeze({ ...value, consumer: NEXT_APP_CONSUMER })
    },
    {
      label: 'namespace',
      grant: (value: TerminalAuthorityNamespaceAdmissionGrant) =>
        Object.freeze({
          ...value,
          namespace: Object.freeze({ ...value.namespace, namespaceId: 'other-namespace' })
        })
    }
  ])('rejects a host response with the wrong $label', async ({ grant }) => {
    const store = await memoryStore()
    const host = hostHarness([boundary(0)], undefined, { grant })
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {}
    })

    await expect(pump.start(APP_CONSUMER)).rejects.toThrow('wrong admission grant')

    expect(host.acceptBoundary).not.toHaveBeenCalled()
    expect(host.acknowledge).not.toHaveBeenCalled()
    expect(store.snapshotAll()).toEqual([])
    store.close()
  })

  it('serializes each namespace while independent namespaces continue', async () => {
    const store = await memoryStore()
    const firstAck = deferred<number>()
    const applied: string[] = []
    const host = hostHarness(
      [
        boundary(0, {
          namespaceId: 'namespace-a',
          projection: authorityProjection({ namespaceId: 'namespace-a' })
        }),
        boundary(0, {
          namespaceId: 'namespace-b',
          projection: authorityProjection({ namespaceId: 'namespace-b' })
        })
      ],
      (ack) =>
        ack.namespace.namespaceId === 'namespace-a' && ack.sequence === 1
          ? firstAck.promise
          : Promise.resolve(ack.sequence)
    )
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: (change) => {
        const row = change.rows[0]
        if (row?.latestEvent) {
          applied.push(`${row.namespace.namespaceId}:${row.latestEvent.sequence}`)
        }
      }
    })
    await pump.start(APP_CONSUMER, {
      namespace: { ...NAMESPACE, namespaceId: 'namespace-a' }
    })
    await pump.admitNamespace({ ...NAMESPACE, namespaceId: 'namespace-b' })

    const first = host.publish(
      semanticPublication(1, { kind: 'bell' }, { namespaceId: 'namespace-a' })
    )
    const second = host.publish(
      semanticPublication(2, { kind: 'agent-working' }, { namespaceId: 'namespace-a' })
    )
    await host.publish(semanticPublication(1, { kind: 'bell' }, { namespaceId: 'namespace-b' }))

    expect(applied).toContain('namespace-a:1')
    expect(applied).toContain('namespace-b:1')
    expect(applied).not.toContain('namespace-a:2')
    firstAck.resolve(1)
    await Promise.all([first, second])
    expect(applied.at(-1)).toBe('namespace-a:2')
    pump.dispose()
    store.close()
  })

  it('commits and cumulatively ACKs a bounded page once', async () => {
    const store = await memoryStore()
    const host = hostHarness([boundary(0)])
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {}
    })
    await pump.start(APP_CONSUMER)
    const outcomes = Array.from(
      { length: 64 },
      (_, index) =>
        semanticPublication(index + 1, {
          kind: 'title',
          normalizedTitle: `title-${index + 1}`,
          rawTitle: `title-${index + 1}`
        }).outcome
    )

    await host.publish({
      ...semanticPublication(1),
      outcome: outcomes[0]!,
      outcomes
    })

    expect(host.acknowledge).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sequence: 64, outcomeId: 'semantic-namespace-1-64' })
    )
    expect(store.statistics()).toEqual({ rows: 1, writeTransactions: 2, writtenRows: 2 })
    pump.dispose()
    store.close()
  })

  it('rejects a page whose compatibility head conflicts with its first canonical outcome', async () => {
    const store = await memoryStore()
    const host = hostHarness([boundary(0)])
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {}
    })
    await pump.start(APP_CONSUMER)
    const canonical = semanticPublication(1, {
      kind: 'title',
      normalizedTitle: 'canonical',
      rawTitle: 'canonical'
    })

    await expect(
      host.publish({
        ...canonical,
        outcome: semanticPublication(1, { kind: 'bell' }).outcome,
        outcomes: [canonical.outcome]
      })
    ).rejects.toThrow('publication is invalid')

    expect(host.acknowledge).not.toHaveBeenCalled()
    expect(store.snapshot(APP_CONSUMER.consumerId)[0]?.facts).toEqual({})
    pump.dispose()
    store.close()
  })

  it('replays against the acknowledged projection before reconciling the high-water snapshot', async () => {
    const store = await memoryStore()
    store.beginBoundary(boundary(0))
    const original = authorityProjection().panes[0]!
    const replacementBinding = {
      ownerIncarnationId: 'owner-2',
      physicalPtyId: 'pty-2',
      ptyIncarnationId: 'pty-incarnation-2'
    }
    const finalProjection = authorityProjection({
      revision: 2,
      panes: [
        {
          ...original,
          binding: replacementBinding,
          lastBinding: replacementBinding,
          revision: 2
        }
      ]
    })
    const host = hostHarness([
      boundary(0, {
        outcomeHighWatermark: 1,
        projection: finalProjection,
        consumerStart: 'resume'
      })
    ])
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {}
    })

    await pump.start(APP_CONSUMER)
    await host.publish(semanticPublication(1))

    expect(host.acknowledge).toHaveBeenCalledWith(expect.objectContaining({ sequence: 1 }))
    expect(store.snapshot(APP_CONSUMER.consumerId)[0]).toMatchObject({
      binding: replacementBinding,
      facts: {}
    })
    pump.dispose()
    store.close()
  })

  it('initializes a newly attested namespace at a nonzero host tail', async () => {
    const store = await memoryStore()
    const host = hostHarness([boundary(9, { consumerStart: 'new-at-tail' })])
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {}
    })

    await pump.start(APP_CONSUMER)

    expect(store.snapshot(APP_CONSUMER.consumerId)).toHaveLength(1)
    expect(host.acknowledge).not.toHaveBeenCalled()
    pump.dispose()
    store.close()
  })

  it('rejects an unattested initial boundary without retrying local admission', async () => {
    const store = await memoryStore()
    const { consumerStart: _consumerStart, ...unattested } = boundary(0)
    const host = hostHarness([unattested])
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {}
    })

    await expect(pump.start(APP_CONSUMER)).rejects.toThrow('boundary is invalid')

    expect(host.connect).toHaveBeenCalledTimes(1)
    store.close()
  })

  it('rejects an initial boundary without the complete host semantic projection', async () => {
    const store = await memoryStore()
    const complete = authorityProjection()
    const { materializedOutcomes: _materializedOutcomes, ...incomplete } = complete
    const host = hostHarness([boundary(0, { projection: incomplete })])
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {}
    })

    await expect(pump.start(APP_CONSUMER)).rejects.toThrow('boundary is invalid')

    expect(host.connect).toHaveBeenCalledTimes(1)
    store.close()
  })

  it('fences a never-settling old ACK before connecting and draining a successor', async () => {
    const store = await memoryStore()
    const blockedAck = deferred<number>()
    let cursor = 0
    const host = hostHarness(
      () => [boundary(cursor)],
      async (ack) => {
        if (host.connect.mock.calls.length === 1) {
          return blockedAck.promise
        }
        cursor = ack.sequence
        return cursor
      }
    )
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {},
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1
    })
    await pump.start(APP_CONSUMER)

    const stale = host.publish(semanticPublication(1))
    await vi.waitFor(() => expect(host.acknowledge).toHaveBeenCalledTimes(1))
    host.fail(new Error('connection lost'))
    await expect(stale).rejects.toThrow('generation was canceled')
    await vi.waitFor(() => expect(host.connect).toHaveBeenCalledTimes(2))
    await host.publish(semanticPublication(1))

    expect(cursor).toBe(1)
    pump.dispose()
    store.close()
  })

  it('retries a failed reconnect with bounded backoff until the host recovers', async () => {
    const store = await memoryStore()
    const host = hostHarness([boundary(0)], undefined, { failedConnectAttempts: [2] })
    const failures = vi.fn()
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {},
      onError: failures,
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1
    })
    await pump.start(APP_CONSUMER)

    host.fail(new Error('connection lost'))
    await vi.waitFor(() => expect(host.connect).toHaveBeenCalledTimes(3))
    await host.publish(semanticPublication(1))

    expect(failures).toHaveBeenCalledWith(expect.objectContaining({ message: 'reconnect failed' }))
    pump.dispose()
    store.close()
  })

  it('backs off when the host transport generation is unavailable', async () => {
    const store = await memoryStore()
    const host = hostHarness([boundary(0)], undefined, { failedHostConnectAttempts: [1, 2] })
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {},
      reconnectBaseDelayMs: 5,
      reconnectMaxDelayMs: 5
    })

    await pump.start(APP_CONSUMER)

    expect(host.connectHost).toHaveBeenCalledTimes(3)
    pump.dispose()
    store.close()
  })

  it('bounds queued work per namespace and reconnects without retaining the old queue', async () => {
    const store = await memoryStore()
    const blockedAck = deferred<number>()
    const host = hostHarness([boundary(0)], () => blockedAck.promise)
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {},
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1
    })
    await pump.start(APP_CONSUMER)

    const publications = Array.from({ length: 5 }, (_, index) =>
      host.publish(semanticPublication(index + 1))
    )
    await expect(publications[4]).rejects.toThrow('queue capacity exceeded')
    await Promise.allSettled(publications.slice(0, 4))
    await vi.waitFor(() => expect(host.connect).toHaveBeenCalledTimes(2))

    expect(store.statistics().rows).toBe(1)
    pump.dispose()
    store.close()
  })

  it('bounds ACK settlement and reconnects without treating timeout as ACK', async () => {
    const store = await memoryStore()
    const host = hostHarness([boundary(0)], () => new Promise<number>(() => {}))
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {},
      acknowledgeTimeoutMs: 5,
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1
    })
    await pump.start(APP_CONSUMER)

    await expect(host.publish(semanticPublication(1))).rejects.toThrow('settlement timed out')
    await vi.waitFor(() => expect(host.connect).toHaveBeenCalledTimes(2))
    pump.dispose()
    store.close()
  })

  it('retries the exact proof after lost admission responses', async () => {
    const store = await memoryStore()
    const host = hostHarness([boundary(0)], undefined, { failedConnectAttempts: [1, 2] })
    const failures = vi.fn()
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {},
      onError: failures,
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1
    })

    await pump.start(APP_CONSUMER)

    expect(host.connect).toHaveBeenCalledTimes(3)
    expect(host.connect.mock.calls[1]?.[0]).toEqual(host.connect.mock.calls[0]?.[0])
    expect(host.connect.mock.calls[2]?.[0]).toEqual(host.connect.mock.calls[0]?.[0])
    expect(failures).toHaveBeenCalledTimes(2)
    pump.dispose()
    store.close()
  })

  it('retains one unresolved exact admission request across settlement timeouts', async () => {
    const store = await memoryStore()
    const connectNamespace = vi.fn(() => new Promise<never>(() => {}))
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: {
        authenticatedAuthorityHostId: NAMESPACE.authorityHostId,
        connect: async () => ({
          authenticatedAuthorityHostId: NAMESPACE.authorityHostId,
          resolveNamespace: async () => NAMESPACE,
          openNamespace: connectNamespace,
          retireNamespace: vi.fn(),
          disconnect: () => {}
        })
      },
      onProjection: () => {},
      connectTimeoutMs: 5,
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1
    })

    const starting = pump.start(APP_CONSUMER)
    await vi.waitFor(() => expect(connectNamespace).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(connectNamespace).toHaveBeenCalledOnce()
    pump.dispose()
    await expect(starting).rejects.toThrow('canceled')
    store.close()
  })

  it('fails closed for a returning consumer with a missing projection database', async () => {
    const store = await memoryStore()
    const host = hostHarness([boundary(9, { consumerStart: 'resume' })])
    const pump = new TerminalAuthorityAppOutcomeNamespaceHarness({
      store,
      host: host.transport,
      onProjection: () => {}
    })

    await expect(pump.start(APP_CONSUMER)).rejects.toThrow('history is unavailable')
    expect(host.acknowledge).not.toHaveBeenCalled()
    store.close()
  })
})

function hostHarness(
  boundaries:
    | readonly TerminalAuthorityNamespaceOutcomeBoundary[]
    | (() => readonly TerminalAuthorityNamespaceOutcomeBoundary[]),
  acknowledgeResult:
    | ((ack: TerminalAuthorityNamespaceOutcomeAck) => Promise<number>)
    | undefined = (ack) => Promise.resolve(ack.sequence),
  options: Readonly<{
    failedConnectAttempts?: readonly number[]
    failedHostConnectAttempts?: readonly number[]
    acceptBoundary?: (acceptance: TerminalAuthorityNamespaceBoundaryAcceptance) => Promise<void>
    preserveBoundaryId?: boolean
    grant?: (
      value: TerminalAuthorityNamespaceAdmissionGrant
    ) => TerminalAuthorityNamespaceAdmissionGrant
  }> = {}
) {
  const sinks = new Map<string, TerminalAuthorityPolicyOutcomeTransport>()
  let failConnectedHost: ((error: unknown) => void) | null = null
  let attempt = 0
  const claimedNamespaces = new Set<string>()
  const acknowledge = vi.fn(acknowledgeResult)
  const acceptBoundary = vi.fn(async (acceptance: TerminalAuthorityNamespaceBoundaryAcceptance) => {
    claimedNamespaces.add(namespaceKey(acceptance.namespace))
    await options.acceptBoundary?.(acceptance)
  })
  const connect = vi.fn(
    async (
      request: TerminalAuthorityAppNamespaceAdmissionRequest,
      transport: TerminalAuthorityPolicyOutcomeTransport
    ) => {
      attempt += 1
      if (options.failedConnectAttempts?.includes(attempt)) {
        throw new Error('reconnect failed')
      }
      const namespace = request.namespace
      const consumer = Object.freeze({
        consumerId: APP_CONSUMER.consumerId,
        consumerIncarnationId: request.candidateProcessIncarnationId
      })
      const key = namespaceKey(namespace)
      sinks.set(key, transport)
      const grant = Object.freeze({
        version: 1 as const,
        consumer,
        namespace,
        requestId: request.requestId,
        connectionGrantId: `connection-grant:${request.requestId}`,
        admissionCas: 'admission-cas-after',
        replayed: attempt > 1
      })
      return {
        expectedConsumer: consumer,
        grant: options.grant?.(grant) ?? grant,
        activate: vi.fn(async () => {
          for (const candidate of typeof boundaries === 'function' ? boundaries() : boundaries) {
            if (namespaceKey(candidate.namespace) !== key) {
              continue
            }
            const { boundaryId: _boundaryId, ...unsignedCandidate } = candidate
            const unsigned = {
              ...unsignedCandidate,
              consumer,
              consumerStart: claimedNamespaces.has(namespaceKey(candidate.namespace))
                ? ('resume' as const)
                : candidate.consumerStart
            }
            await transport.publishBoundary({
              ...unsigned,
              boundaryId:
                options.preserveBoundaryId && candidate.boundaryId
                  ? candidate.boundaryId
                  : terminalSessionAuthorityBoundaryId(unsigned)
            })
          }
        }),
        acceptBoundary,
        acknowledge,
        retire: vi.fn(),
        disconnect: vi.fn(() => {
          if (sinks.get(key) === transport) {
            sinks.delete(key)
          }
        })
      }
    }
  )
  const connectHost = vi.fn(async (lifecycle: Readonly<{ onFailure(error: unknown): void }>) => {
    if (options.failedHostConnectAttempts?.includes(connectHost.mock.calls.length)) {
      throw new Error('host transport unavailable')
    }
    failConnectedHost = lifecycle.onFailure
    return {
      authenticatedAuthorityHostId: NAMESPACE.authorityHostId,
      resolveNamespace: async () => NAMESPACE,
      openNamespace: connect,
      retireNamespace: vi.fn(),
      disconnect: vi.fn()
    }
  })
  const transport: TerminalAuthorityAppOutcomeHostTransport = {
    authenticatedAuthorityHostId: NAMESPACE.authorityHostId,
    connect: connectHost
  }
  return {
    transport,
    connect,
    connectHost,
    acceptBoundary,
    acknowledge,
    publish(publication: Parameters<TerminalAuthorityPolicyOutcomeTransport['publishOutcome']>[0]) {
      const sink = sinks.get(namespaceKey(publication.namespace))
      if (!sink) {
        throw new Error('host sink unavailable')
      }
      return sink.publishOutcome(publication)
    },
    fail(error: Error, namespace: TerminalAuthorityNamespace = NAMESPACE) {
      const sink = sinks.get(namespaceKey(namespace))
      if (!sink) {
        throw new Error('host sink unavailable')
      }
      sink.onFailure?.(error)
    },
    failHost(error: Error) {
      if (!failConnectedHost) {
        throw new Error('host connection unavailable')
      }
      failConnectedHost(error)
    }
  }
}

function namespaceKey(namespace: { authorityHostId: string; namespaceId: string }): string {
  return JSON.stringify([namespace.authorityHostId, namespace.namespaceId])
}

async function memoryStore(): Promise<TerminalAuthorityAppProjectionStore> {
  const directory = await mkdtemp(path.join(tmpdir(), 'orca-app-pump-'))
  directories.push(directory)
  return TerminalAuthorityAppProjectionStore.open({ directory, databasePath: ':memory:' })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
