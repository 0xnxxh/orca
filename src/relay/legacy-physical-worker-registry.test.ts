import { describe, expect, it } from 'vitest'
import type {
  TerminalLegacyCutoverProof,
  TerminalLegacyWorkerRoute
} from '../shared/terminal-legacy-cutover'
import {
  LegacyPhysicalWorkerClient,
  openLegacyPhysicalWorker,
  type LegacyPhysicalWorkerRpc
} from './legacy-physical-worker-client'
import { preserveLegacyPhysicalWorkerAuthorityRoutes } from './legacy-physical-worker-authority-preservation'
import { legacyPhysicalWorkerRelayState } from './legacy-physical-worker-relay-state'
import { LegacyPhysicalWorkerRegistry } from './legacy-physical-worker-registry'

describe('legacy physical worker client', () => {
  it('negotiates existing owner, source-credit, and exact-operation protocols', async () => {
    const rpc = new FakeWorkerRpc()
    const opened = await openLegacyPhysicalWorker({
      rpc,
      clientInstanceId: 'authority-broker',
      expectedBuildId: 'build-a',
      requestedSourceWindowSu: 1024
    })

    expect(opened.status).toBe('supported')
    if (opened.status !== 'supported') {
      return
    }
    await expect(opened.client.prepareCutoverGrace()).resolves.toEqual({ status: 'ready' })
    await expect(opened.client.sampleCutoverStatus()).resolves.toMatchObject({
      pid: 99,
      legacyCutover: {
        configuredGraceMs: 0,
        acknowledged: true,
        brokerConnectionIdentity: 'authority-broker:2:3'
      },
      socket: { clients: 1, acceptedConnections: 4 }
    })
    expect(rpc.requests[0]).toEqual({
      method: 'pty.openClient',
      params: expect.objectContaining({
        protocolVersion: 1,
        clientInstanceId: 'authority-broker',
        capabilities: {
          outputFlowControl: { versions: [1], requestedWindowSu: 1024 },
          exactOperations: { versions: [1] },
          heldProducerPause: { versions: [1] }
        }
      })
    })
    await expect(opened.client.listPtys()).resolves.toEqual([
      {
        id: 'pty-1',
        incarnationId: 'incarnation-1',
        processId: 123,
        cwd: '/repo',
        title: 'bash'
      }
    ])
    await expect(
      opened.client.attach({ id: 'pty-1', incarnationId: 'incarnation-1' })
    ).resolves.toMatchObject({ incarnationId: 'incarnation-1' })
    await expect(
      opened.client.setHeldProducerPause({
        id: 'pty-1',
        clientGeneration: 2,
        ownerGeneration: 3,
        ptyIncarnationId: 'incarnation-1',
        heldPauseToken: 'held-1',
        paused: true
      })
    ).resolves.toBe(true)
    opened.client.write('pty-1', 'incarnation-1', 'echo ok')
    opened.client.resize('pty-1', 'incarnation-1', 100, 40)
    await expect(opened.client.shutdown('pty-1', 'incarnation-1')).resolves.toBe(true)
    opened.client.acknowledgeSource([
      {
        id: 'pty-1',
        clientGeneration: 2,
        ownerGeneration: 3,
        deliveryToken: 'delivery',
        creditedEndSu: 9
      }
    ])
    await expect(
      opened.client.publishSourceAcknowledgement(
        {
          id: 'pty-1',
          clientGeneration: 2,
          ownerGeneration: 3,
          deliveryToken: 'delivery',
          creditedEndSu: 9
        },
        'ack-9'
      )
    ).resolves.toBeUndefined()
    expect(rpc.notifications.map((entry) => entry.method)).toEqual([
      'pty.dataExact',
      'pty.resizeExact',
      'pty.ackData',
      'pty.ackData'
    ])
    expect(rpc.requests.map((entry) => entry.method)).toContain('pty.shutdownExact')
  })

  it('degrades a mixed-version worker to unsupported without legacy mutation fallback', async () => {
    const rpc = new FakeWorkerRpc()
    rpc.requestImplementation = async (method) => {
      if (method === 'pty.openClient') {
        throw Object.assign(new Error('Method not found: pty.openClient'), { code: -32601 })
      }
      throw new Error(`unexpected request ${method}`)
    }

    await expect(
      openLegacyPhysicalWorker({
        rpc,
        clientInstanceId: 'authority-broker',
        expectedBuildId: 'old-build',
        requestedSourceWindowSu: 1024
      })
    ).resolves.toEqual({ status: 'unsupported', reason: 'pty.openClient-unsupported' })
    expect(rpc.notifications).toEqual([])
    expect(rpc.requests.map((entry) => entry.method)).toEqual(['pty.openClient'])
  })

  it('rejects a grant that omits exact mutations or source credit', async () => {
    const rpc = new FakeWorkerRpc()
    rpc.openGrant = { ...rpc.openGrant, capabilities: undefined }
    await expect(
      openLegacyPhysicalWorker({
        rpc,
        clientInstanceId: 'authority-broker',
        expectedBuildId: 'build-a',
        requestedSourceWindowSu: 1024
      })
    ).resolves.toEqual({
      status: 'unsupported',
      reason: 'required-worker-capabilities-not-granted'
    })
  })

  it('translates origin-main mutations only through fresh fenced identity proof', async () => {
    const rpc = new FakeWorkerRpc()
    rpc.openGrant = {
      ...rpc.openGrant,
      ownerLease: 'lease',
      capabilities: {
        outputFlowControl: { version: 1, windowSu: 1024 },
        heldProducerPause: { version: 1 }
      }
    }
    const opened = await openLegacyPhysicalWorker({
      rpc,
      clientInstanceId: 'authority-broker',
      expectedBuildId: 'build-a',
      requestedSourceWindowSu: 1024
    })
    expect(opened.status).toBe('supported')
    if (opened.status !== 'supported') {
      return
    }
    expect(opened.client.capabilities).toMatchObject({
      exactOperationsVersion: null,
      mutationMode: 'legacy-fenced-v1'
    })
    const route = workerRoute('owner-1', 'route-1')
    const registry = new LegacyPhysicalWorkerRegistry()
    let processMatches = true
    await expect(
      registry.register(workerRegistration(route, opened.client, async () => processMatches))
    ).resolves.toEqual({ status: 'registered', replaced: false })

    const pty = { id: 'pty-1', incarnationId: 'incarnation-1' }
    await expect(
      registry.dispatchPtyMutation('owner-1', pty, { kind: 'data', data: 'echo safe' })
    ).resolves.toBe(true)
    expect(rpc.notifications.at(-1)).toEqual({
      method: 'pty.data',
      params: { id: 'pty-1', data: 'echo safe' }
    })
    expect(() => opened.client.write(pty.id, pty.incarnationId, 'unsafe')).toThrow(
      'requires registry verification'
    )

    rpc.ptyInventory[0] = { ...rpc.ptyInventory[0], incarnationId: 'replacement-incarnation' }
    await expect(
      registry.dispatchPtyMutation('owner-1', pty, { kind: 'resize', cols: 90, rows: 30 })
    ).resolves.toBe(false)
    expect(rpc.notifications.some((entry) => entry.method === 'pty.resize')).toBe(false)
    rpc.ptyInventory[0] = { ...rpc.ptyInventory[0], incarnationId: pty.incarnationId }
    processMatches = false
    await expect(registry.attachPty('owner-1', pty)).resolves.toBeNull()
    expect(rpc.requests.filter((entry) => entry.method === 'pty.attach')).toHaveLength(0)
    expect(registry.lifecycleCounts()).toEqual({
      activeWorkerCount: 0,
      pendingWorkerCount: 1,
      lifecycleHoldCount: 1
    })
    registry.dispose()
  })

  it('does not infer zero grace when a mixed-version relay lacks the request', async () => {
    const rpc = new FakeWorkerRpc()
    const opened = await openLegacyPhysicalWorker({
      rpc,
      clientInstanceId: 'authority-broker',
      expectedBuildId: 'build-a',
      requestedSourceWindowSu: 1024
    })
    expect(opened.status).toBe('supported')
    if (opened.status !== 'supported') {
      return
    }
    rpc.requestImplementation = async (method) => {
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 })
    }
    await expect(opened.client.prepareCutoverGrace()).resolves.toEqual({
      status: 'unsupported',
      reason: 'zero-grace-unsupported'
    })
    await expect(opened.client.sampleCutoverStatus()).rejects.toThrow(
      'zero grace was not acknowledged'
    )
  })
})

describe('legacy physical worker registry', () => {
  it('preserves an unreachable owner until an exact causal unregister', async () => {
    const rpc = new FakeWorkerRpc()
    const client = workerClient(rpc)
    const registry = new LegacyPhysicalWorkerRegistry(2)
    let processMatches = true
    const route = workerRoute('owner-1', 'route-1')

    await expect(
      registry.register(workerRegistration(route, client, async () => processMatches))
    ).resolves.toEqual({ status: 'registered', replaced: false })
    await expect(registry.resolve('owner-1')).resolves.toMatchObject({ route })

    processMatches = false
    await expect(registry.resolve('owner-1')).resolves.toBeNull()
    expect(registry.size).toBe(1)
    expect(registry.lifecycleCounts()).toEqual({
      activeWorkerCount: 0,
      pendingWorkerCount: 1,
      lifecycleHoldCount: 1
    })
    expect(rpc.closeCalls).toBe(0)

    expect(registry.unregister({ ownerIncarnationId: 'owner-1', routeId: 'stale-route' })).toBe(
      false
    )
    expect(registry.unregister({ ownerIncarnationId: 'owner-1', routeId: 'route-1' })).toBe(true)
    expect(registry.lifecycleHoldCount).toBe(0)
    expect(rpc.closeCalls).toBe(1)
    registry.dispose()
  })

  it('keeps close idempotent and permits only same-route reconnection', async () => {
    const firstRpc = new FakeWorkerRpc()
    const firstClient = workerClient(firstRpc)
    const registry = new LegacyPhysicalWorkerRegistry()
    await registry.register(
      workerRegistration(workerRoute('owner-1', 'route-1'), firstClient, async () => true)
    )
    const firstRoute = await registry.resolveExactPtyRoute('owner-1', {
      id: 'pty-1',
      incarnationId: 'incarnation-1'
    })
    expect(firstRoute?.isCurrent()).toBe(true)
    expect(firstRpc.requests.filter((entry) => entry.method === 'pty.listProcesses')).toHaveLength(
      1
    )

    firstRpc.disconnect()
    firstRpc.disconnect()
    expect(firstRoute?.isCurrent()).toBe(false)
    expect(registry.lifecycleCounts()).toEqual({
      activeWorkerCount: 0,
      pendingWorkerCount: 1,
      lifecycleHoldCount: 1
    })
    await expect(
      registry.register(
        workerRegistration(
          workerRoute('owner-1', 'route-2'),
          workerClient(new FakeWorkerRpc()),
          async () => true
        )
      )
    ).resolves.toEqual({ status: 'conflict', routeId: 'route-1' })

    const replacementRpc = new FakeWorkerRpc()
    const replacementClient = workerClient(replacementRpc)
    await expect(
      registry.register(
        workerRegistration(workerRoute('owner-1', 'route-1'), replacementClient, async () => true)
      )
    ).resolves.toEqual({ status: 'registered', replaced: true })
    const replacementRoute = await registry.resolveExactPtyRoute('owner-1', {
      id: 'pty-1',
      incarnationId: 'incarnation-1'
    })
    expect(replacementRoute?.generation).toBeGreaterThan(firstRoute?.generation ?? 0)
    expect(replacementRoute?.isCurrent()).toBe(true)
    expect(registry.lifecycleCounts()).toEqual({
      activeWorkerCount: 1,
      pendingWorkerCount: 0,
      lifecycleHoldCount: 1
    })
    registry.dispose()
    registry.dispose()
    expect(registry.size).toBe(0)
    expect(firstRpc.closeCalls).toBe(0)
    expect(replacementRpc.closeCalls).toBe(1)
  })

  it('never evicts an unreachable preservation obligation to admit beyond its bound', async () => {
    const firstRpc = new FakeWorkerRpc()
    const secondRpc = new FakeWorkerRpc()
    const registry = new LegacyPhysicalWorkerRegistry(1)
    let firstProcessMatches = true
    await registry.register(
      workerRegistration(
        workerRoute('owner-1', 'route-1'),
        workerClient(firstRpc),
        async () => firstProcessMatches
      )
    )
    await expect(
      registry.register(
        workerRegistration(
          workerRoute('owner-2', 'route-2'),
          workerClient(secondRpc),
          async () => true
        )
      )
    ).resolves.toEqual({ status: 'capacity' })
    expect(firstRpc.closeCalls).toBe(0)

    firstProcessMatches = false
    await expect(registry.resolve('owner-1')).resolves.toBeNull()
    await expect(
      registry.register(
        workerRegistration(
          workerRoute('owner-2', 'route-2'),
          workerClient(secondRpc),
          async () => true
        )
      )
    ).resolves.toEqual({ status: 'capacity' })
    expect(firstRpc.closeCalls).toBe(0)
    expect(registry.size).toBe(1)
    registry.dispose()
  })

  it('hydrates bounded lifecycle holds without treating catalog rows as reachable', async () => {
    const registry = new LegacyPhysicalWorkerRegistry(1)
    expect(registry.preserve({ ownerIncarnationId: 'owner-1', routeId: 'route-1' })).toEqual({
      status: 'preserved',
      alreadyPresent: false
    })
    expect(registry.preserve({ ownerIncarnationId: 'owner-1', routeId: 'route-1' })).toEqual({
      status: 'preserved',
      alreadyPresent: true
    })
    expect(registry.lifecycleCounts()).toEqual({
      activeWorkerCount: 0,
      pendingWorkerCount: 1,
      lifecycleHoldCount: 1
    })
    await expect(registry.resolve('owner-1')).resolves.toBeNull()
    expect(registry.preserve({ ownerIncarnationId: 'owner-2', routeId: 'route-2' })).toEqual({
      status: 'capacity'
    })
    await expect(
      registry.register(
        workerRegistration(
          workerRoute('owner-1', 'route-1'),
          workerClient(new FakeWorkerRpc()),
          async () => true
        )
      )
    ).resolves.toEqual({ status: 'registered', replaced: false })
    expect(registry.lifecycleCounts()).toEqual({
      activeWorkerCount: 1,
      pendingWorkerCount: 0,
      lifecycleHoldCount: 1
    })
    expect(
      registry.releasePreservation({ ownerIncarnationId: 'owner-1', routeId: 'route-1' })
    ).toBe(true)
    expect(registry.lifecycleHoldCount).toBe(1)
    registry.dispose()
  })

  it('keeps catalog preservation non-idle until exact causal release', () => {
    const registry = new LegacyPhysicalWorkerRegistry(1)
    const lifecycleHoldCounts: number[] = []
    const removeListener = registry.onLifecycleChanged(() => {
      lifecycleHoldCounts.push(registry.lifecycleHoldCount)
    })

    preserveLegacyPhysicalWorkerAuthorityRoutes(registry, [
      { ownerIncarnationId: 'owner-1', routeId: 'route-1' }
    ])
    expect(registry.lifecycleCounts()).toEqual({
      activeWorkerCount: 0,
      pendingWorkerCount: 1,
      lifecycleHoldCount: 1
    })
    expect(
      legacyPhysicalWorkerRelayState({
        localActivePtyCount: 0,
        pendingPtyCreationCount: 0,
        lifecycle: registry
      })
    ).toEqual({ protectedPtyCount: 1, idle: false })

    expect(
      registry.releasePreservation({ ownerIncarnationId: 'owner-1', routeId: 'route-1' })
    ).toBe(true)
    expect(lifecycleHoldCounts).toEqual([1, 0])
    removeListener()
    registry.dispose()
  })

  it('routes imported attach through exact owner, pane, and PTY identity proof', async () => {
    const rpc = new FakeWorkerRpc()
    const registry = new LegacyPhysicalWorkerRegistry()
    await registry.register(
      workerRegistration(workerRoute('owner-1', 'route-1'), workerClient(rpc), async () => true)
    )

    await expect(
      registry.attachPty('owner-1', {
        id: 'pty-1',
        incarnationId: 'incarnation-1',
        expectedPaneKey: 'pane-a',
        expectedTabId: 'tab-a'
      })
    ).resolves.toMatchObject({ incarnationId: 'incarnation-1' })
    expect(rpc.requests.at(-1)).toEqual({
      method: 'pty.attach',
      params: {
        id: 'pty-1',
        expectedIncarnationId: 'incarnation-1',
        expectedPtyIncarnationId: 'incarnation-1',
        expectedPaneKey: 'pane-a',
        expectedTabId: 'tab-a',
        suppressReplayNotification: true
      }
    })
    registry.dispose()
  })
})

class FakeWorkerRpc implements LegacyPhysicalWorkerRpc {
  readonly requests: { method: string; params?: Record<string, unknown> }[] = []
  readonly notifications: { method: string; params: Record<string, unknown> }[] = []
  private readonly closeListeners = new Set<() => void>()
  private open = true
  closeCalls = 0
  ptyInventory = [
    {
      id: 'pty-1',
      incarnationId: 'incarnation-1',
      processId: 123,
      cwd: '/repo',
      title: 'bash'
    }
  ]
  openGrant: Record<string, unknown> = {
    protocolVersion: 1,
    serverBuildId: 'build-a',
    clientGeneration: 2,
    role: 'session-owner',
    ownerGeneration: 3,
    ownerLease: 'owner-lease',
    resumed: false,
    capabilities: {
      outputFlowControl: { version: 1, windowSu: 1024 },
      exactOperations: { version: 1 },
      heldProducerPause: { version: 1 }
    }
  }
  requestImplementation = async (method: string): Promise<unknown> => {
    if (method === 'pty.openClient') {
      return this.openGrant
    }
    if (method === 'pty.listProcesses') {
      return this.ptyInventory
    }
    if (method === 'relay.configureGraceTime') {
      return { graceTimeMs: 0 }
    }
    if (method === 'relay.status') {
      return {
        pid: 99,
        socket: {
          path: '/relay.sock',
          listening: true,
          clients: 1,
          acceptedConnections: 4
        }
      }
    }
    if (method === 'pty.attach') {
      return { incarnationId: 'incarnation-1', sourceActivation: { deliveryToken: 'delivery' } }
    }
    if (method === 'pty.setDeliveryPaused') {
      return { applied: true }
    }
    if (method.endsWith('Exact')) {
      return { accepted: true }
    }
    if (['pty.shutdown', 'pty.sendSignal', 'pty.clearBuffer'].includes(method)) {
      return {}
    }
    throw new Error(`unexpected request ${method}`)
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.requests.push({ method, ...(params ? { params } : {}) })
    return await this.requestImplementation(method)
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.notifications.push({ method, params })
  }

  notifyWithSettlement(
    method: string,
    params: Record<string, unknown>,
    onSettled: (result: { ok: true } | { ok: false; error: Error }) => void
  ): void {
    this.notify(method, params)
    onSettled({ ok: true })
  }

  onNotification(): () => void {
    return () => {}
  }

  isOpen(): boolean {
    return this.open
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  close(): void {
    this.closeCalls++
    this.disconnect()
  }

  disconnect(): void {
    if (!this.open) {
      return
    }
    this.open = false
    for (const listener of this.closeListeners) {
      listener()
    }
  }
}

function workerClient(rpc: FakeWorkerRpc): LegacyPhysicalWorkerClient {
  return new LegacyPhysicalWorkerClient(
    rpc,
    {
      protocolVersion: 1,
      serverBuildId: 'build-a',
      clientGeneration: 2,
      role: 'session-owner',
      ownerGeneration: 3,
      ownerLease: 'lease',
      resumed: false
    },
    {
      consumerSessionVersion: 1,
      outputFlowControlVersion: 1,
      exactOperationsVersion: 1,
      heldProducerPauseVersion: 1,
      mutationMode: 'exact-v1',
      sourceWindowSu: 1024
    }
  )
}

function workerRegistration(
  route: TerminalLegacyWorkerRoute,
  client: LegacyPhysicalWorkerClient,
  processMatches: () => Promise<boolean>
) {
  return { route, cutover: cutoverProof(route, client), client, processMatches }
}

function cutoverProof(
  route: TerminalLegacyWorkerRoute,
  client: LegacyPhysicalWorkerClient
): TerminalLegacyCutoverProof {
  if (route.endpoint.kind !== 'unix-socket') {
    throw new Error('test route must use a Unix socket')
  }
  return Object.freeze({
    kind: 'posix-relocated',
    publicSocketPath: '/relay/public.sock',
    privateSocketPath: route.socketPath,
    publicCredentialFile: '/relay/public.credential',
    privateCredentialFile: route.credentialFile,
    endpointIdentity: route.endpoint,
    brokerClientCount: 1,
    acceptedConnectionCount: 4,
    quiescenceSamples: 2,
    connectionProof: Object.freeze({
      method: 'linux-procfs-unix',
      listenerIdentity: `${route.process.pid}:socket:${route.endpoint.inode}`,
      brokerConnectionIdentity: client.brokerConnectionIdentity,
      acceptedServerConnections: 1
    }),
    graceConfiguration: Object.freeze({
      capabilityVersion: 1,
      configuredGraceMs: 0,
      acknowledged: true
    }),
    sealedAtMs: 1
  })
}

function workerRoute(ownerIncarnationId: string, routeId: string): TerminalLegacyWorkerRoute {
  return {
    routeId,
    workerId: `worker-${routeId}`,
    ownerIncarnationId,
    buildId: 'build-a',
    relayDirectory: '/relay',
    socketPath: '/authority/worker.sock',
    credentialFile: '/authority/worker.credential',
    process: { pid: routeId === 'route-1' ? 41 : 42, birthMarker: `birth-${routeId}` },
    endpoint: {
      kind: 'unix-socket',
      device: '1',
      inode: routeId === 'route-1' ? '2' : '3',
      changedAtNs: '4'
    },
    sourceOwner: {
      clientInstanceId: 'authority-broker',
      ownerGeneration: 3,
      ownerLease: 'lease',
      outputWindowSourceUnits: 1024
    },
    gcProtection: { relayDirectories: ['/relay'], evidencePaths: ['/authority'] }
  }
}
