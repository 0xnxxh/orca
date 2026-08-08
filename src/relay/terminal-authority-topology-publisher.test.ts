import { describe, expect, it, vi } from 'vitest'
import type { TerminalAuthorityObserverAccess } from '../main/session-authority/terminal-session-authority-access'
import type { TerminalAuthorityProjectionChange } from '../main/session-authority/terminal-session-authority-service-contract'
import type { TerminalAuthorityNamespace } from '../shared/terminal-session-authority-identity'
import type { TerminalAuthorityProjection } from '../shared/terminal-session-authority-mutation'
import {
  TERMINAL_AUTHORITY_TOPOLOGY_CHANGED_NOTIFICATION,
  TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD,
  TERMINAL_AUTHORITY_TOPOLOGY_UNSUBSCRIBE_NOTIFICATION
} from '../shared/terminal-authority-topology-stream-contract'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import { TerminalAuthorityTopologyPublisher } from './terminal-authority-topology-publisher'

type RequestHandler = (params: Record<string, unknown>, context: RequestContext) => Promise<unknown>
type NotificationHandler = (params: Record<string, unknown>, context: RequestContext) => void

function projection(
  namespace: TerminalAuthorityNamespace,
  revision = 0,
  panes: TerminalAuthorityProjection['panes'] = [],
  allocations: TerminalAuthorityProjection['allocations'] = []
): TerminalAuthorityProjection {
  return Object.freeze({
    namespace,
    writerEpoch: 1,
    revision,
    panes: Object.freeze([...panes]),
    allocations: Object.freeze([...allocations])
  })
}

function unboundPane(revision: number): TerminalAuthorityProjection['panes'][number] {
  return Object.freeze({
    paneKey: 'pane-1',
    paneGenerationId: 'generation-1',
    status: 'open',
    binding: null,
    lastBinding: null,
    revision,
    ownerStatus: null
  })
}

class FakeService {
  readonly events: string[] = []
  private listener: ((change: TerminalAuthorityProjectionChange) => void) | null = null
  private current: TerminalAuthorityProjection

  constructor(readonly namespace: TerminalAuthorityNamespace) {
    this.current = projection(namespace)
  }

  subscribeProjection(
    actorId: string,
    listener: (change: TerminalAuthorityProjectionChange) => void
  ): TerminalAuthorityObserverAccess {
    this.events.push('subscribe')
    this.listener = listener
    return Object.freeze({
      role: 'observer',
      serviceInstanceId: this.namespace.namespaceId,
      accessId: `observer-${this.namespace.namespaceId}`,
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

function harness() {
  const requests = new Map<string, RequestHandler>()
  const notifications = new Map<string, NotificationHandler>()
  const detachListeners = new Set<(clientId: number) => void>()
  const disposeListeners = new Set<() => void>()
  const published: { clientId: number; method: string; params: Record<string, unknown> }[] = []
  const dispatcher = {
    onRequest: vi.fn((method: string, handler: RequestHandler) => requests.set(method, handler)),
    onNotification: vi.fn((method: string, handler: NotificationHandler) =>
      notifications.set(method, handler)
    ),
    onClientDetached: vi.fn((listener: (clientId: number) => void) => {
      detachListeners.add(listener)
      return () => detachListeners.delete(listener)
    }),
    onDisposed: vi.fn((listener: () => void) => {
      disposeListeners.add(listener)
      return () => disposeListeners.delete(listener)
    }),
    tryNotifyClient: vi.fn((clientId: number, method: string, params: Record<string, unknown>) => {
      published.push({ clientId, method, params })
      return true
    }),
    releaseDisplacedClient: vi.fn((clientId: number) => {
      for (const listener of detachListeners) {
        listener(clientId)
      }
    })
  }
  const services = new Map<string, FakeService>()
  const serviceFor = (namespace: TerminalAuthorityNamespace): FakeService => {
    let service = services.get(namespace.namespaceId)
    if (!service) {
      service = new FakeService(namespace)
      services.set(namespace.namespaceId, service)
    }
    return service
  }
  const registry = {
    openNamespace: vi.fn(async (namespace: TerminalAuthorityNamespace) => serviceFor(namespace)),
    legacy: {
      recoveryNoticesForNamespace: vi.fn(() => ({
        version: 1 as const,
        revision: 0,
        notices: Object.freeze([])
      }))
    }
  }
  const onFailure = vi.fn()
  const publisher = new TerminalAuthorityTopologyPublisher(
    dispatcher as unknown as RelayDispatcher,
    registry as never,
    onFailure
  )
  const context = (clientId: number, overrides: Partial<RequestContext> = {}): RequestContext => ({
    clientId,
    isStale: () => false,
    sessionIdentity: {
      principal: 'terminal-authority:host-1',
      authenticated: true,
      allowSessionOwner: true,
      authenticationKind: 'endpoint-credential'
    },
    ...overrides
  })
  const request = (namespace: TerminalAuthorityNamespace, subscriptionId: string) => ({
    protocolVersion: 1,
    subscriptionId,
    namespace
  })
  return {
    requests,
    notifications,
    dispatcher,
    registry,
    publisher,
    published,
    serviceFor,
    context,
    request,
    detach: (clientId: number) => {
      for (const listener of detachListeners) {
        listener(clientId)
      }
    },
    disposeDispatcher: () => {
      for (const listener of disposeListeners) {
        listener()
      }
    }
  }
}

describe('terminal authority topology publisher', () => {
  it('registers only the snapshot and unsubscribe contract and authenticates before opening state', async () => {
    const h = harness()
    const namespace = { authorityHostId: 'host-1', namespaceId: 'namespace-1' }
    const unauthenticated = h.context(7, {
      sessionIdentity: {
        principal: 'relay-endpoint:build',
        authenticated: false,
        allowSessionOwner: false,
        authenticationKind: 'unproved'
      }
    })

    await expect(
      h.requests.get(TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD)?.(
        h.request(namespace, 'subscription-1'),
        unauthenticated
      )
    ).rejects.toThrow('not_authenticated')

    expect(h.registry.openNamespace).not.toHaveBeenCalled()
    expect([...h.requests.keys()]).toEqual([TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD])
    expect([...h.notifications.keys()]).toEqual([
      TERMINAL_AUTHORITY_TOPOLOGY_UNSUBSCRIBE_NOTIFICATION
    ])
  })

  it('subscribes before capture and never exposes authority allocations', async () => {
    const h = harness()
    const namespace = { authorityHostId: 'host-1', namespaceId: 'namespace-1' }
    const service = h.serviceFor(namespace)
    service.publish(
      projection(
        namespace,
        1,
        [],
        [
          {
            allocationId: 'allocation-1',
            spawnFingerprint: 'secret'
          } as never
        ]
      )
    )

    const snapshot = await h.requests.get(TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD)?.(
      h.request(namespace, 'subscription-1'),
      h.context(7)
    )

    expect(service.events.slice(0, 2)).toEqual(['subscribe', 'snapshot'])
    expect(JSON.stringify(snapshot)).not.toContain('allocations')
    expect(JSON.stringify(snapshot)).not.toContain('spawnFingerprint')
  })

  it('replaces a stable subscription ID without leaking observers or duplicate changes', async () => {
    const h = harness()
    const namespace = { authorityHostId: 'host-1', namespaceId: 'namespace-1' }
    const params = h.request(namespace, 'subscription-1')
    const handler = h.requests.get(TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD)!
    await handler(params, h.context(7))
    const service = h.serviceFor(namespace)
    service.publish(projection(namespace, 1, [unboundPane(1)]))

    await handler(params, h.context(7))
    h.notifications.get(TERMINAL_AUTHORITY_TOPOLOGY_UNSUBSCRIBE_NOTIFICATION)?.(
      params,
      h.context(7)
    )

    expect(h.published).toHaveLength(1)
    expect(service.events.filter((event) => event === 'subscribe')).toHaveLength(1)
    expect(service.events.filter((event) => event === 'revoke')).toHaveLength(1)
  })

  it('isolates namespace changes and releases every subscription on client detach', async () => {
    const h = harness()
    const namespaceA = { authorityHostId: 'host-1', namespaceId: 'namespace-a' }
    const namespaceB = { authorityHostId: 'host-1', namespaceId: 'namespace-b' }
    const handler = h.requests.get(TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD)!
    await handler(h.request(namespaceA, 'subscription-a'), h.context(7))
    await handler(h.request(namespaceB, 'subscription-b'), h.context(8))
    h.serviceFor(namespaceA).publish(projection(namespaceA, 1, [unboundPane(1)]))
    await handler(h.request(namespaceA, 'subscription-a'), h.context(7))

    expect(h.published).toEqual([
      expect.objectContaining({
        clientId: 7,
        method: TERMINAL_AUTHORITY_TOPOLOGY_CHANGED_NOTIFICATION,
        params: expect.objectContaining({ namespace: namespaceA, changeSequence: 1 })
      })
    ])
    h.detach(7)
    h.detach(8)
    expect(h.serviceFor(namespaceA).events).toContain('revoke')
    expect(h.serviceFor(namespaceB).events).toContain('revoke')
  })

  it('revokes pending resources when a snapshot request becomes stale', async () => {
    const h = harness()
    const namespace = { authorityHostId: 'host-1', namespaceId: 'namespace-1' }
    let stale = false
    const context = h.context(7, { isStale: () => stale })
    h.registry.openNamespace.mockImplementationOnce(async (value) => {
      stale = true
      return h.serviceFor(value)
    })

    await expect(
      h.requests.get(TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD)?.(
        h.request(namespace, 'subscription-1'),
        context
      )
    ).rejects.toThrow('request_stale')

    expect(h.serviceFor(namespace).events).toEqual(['subscribe', 'revoke'])
  })

  it('disposes channels before the dispatcher finishes teardown', async () => {
    const h = harness()
    const namespace = { authorityHostId: 'host-1', namespaceId: 'namespace-1' }
    await h.requests.get(TERMINAL_AUTHORITY_TOPOLOGY_SNAPSHOT_METHOD)?.(
      h.request(namespace, 'subscription-1'),
      h.context(7)
    )

    h.disposeDispatcher()

    expect(h.serviceFor(namespace).events).toContain('revoke')
    expect(h.publisher.dispose()).toBeUndefined()
  })
})
