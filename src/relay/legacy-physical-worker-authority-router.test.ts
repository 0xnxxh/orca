import { describe, expect, it, vi } from 'vitest'
import type { PtySourceSpan } from '../shared/pty-source-credit-contract'
import type { PtySourceReceivingActivation } from '../shared/pty-source-receiving-activation'
import type { SinkWriteSettlement } from './dispatcher'
import type { LegacyPhysicalWorkerAttachRequest } from './legacy-physical-worker-attach-router'
import { LegacyPhysicalWorkerAuthorityRouter } from './legacy-physical-worker-authority-router'
import {
  LegacyPhysicalWorkerClient,
  type LegacyPhysicalWorkerRpc
} from './legacy-physical-worker-client'
import type { LegacyPhysicalWorkerDownstreamAttachment } from './legacy-physical-worker-downstream'
import type { LegacyPtyProxyExit } from './legacy-pty-proxy'
import type {
  LegacyPtyProxyCheckpointStore,
  LegacyPtyProxyCursorCheckpoint
} from './legacy-pty-proxy-cursor'
import type {
  LegacyPtyProxyCursorRepository,
  LegacyPtyProxyCursorRestore
} from './legacy-pty-proxy-cursor-repository'
import type { LegacyPhysicalWorkerExactRoute } from './legacy-physical-worker-exact-route'

class MemoryLegacyPtyProxyCursorRepository implements LegacyPtyProxyCursorRepository {
  private readonly records = new Map<string, LegacyPtyProxyCursorCheckpoint>()

  restore(bindingKey: string): LegacyPtyProxyCursorRestore | null {
    const checkpoint = this.records.get(bindingKey)
    if (!checkpoint) {
      return null
    }
    return Object.freeze({
      checkpoint,
      cursor: Object.freeze({
        durableDownstreamAckedEndSu: checkpoint.creditedEndSu,
        upstreamAckedEndSu: 0
      }),
      sourceRecovery: Object.freeze({
        status: 'checkpoint',
        clientGeneration: checkpoint.identity.clientGeneration,
        ownerGeneration: checkpoint.identity.ownerGeneration,
        ptyIncarnation: checkpoint.identity.ptyIncarnation,
        deliveryToken: checkpoint.identity.deliveryToken,
        acceptedSourceEndSu: checkpoint.creditedEndSu
      })
    })
  }

  checkpointStore(bindingKey: string): LegacyPtyProxyCheckpointStore {
    return Object.freeze({
      commit: async (checkpoint: LegacyPtyProxyCursorCheckpoint) => {
        const previous = this.records.get(bindingKey)
        if (previous && checkpoint.creditedEndSu < previous.creditedEndSu) {
          throw new Error('legacy PTY proxy cursor regressed')
        }
        this.records.set(bindingKey, Object.freeze(structuredClone(checkpoint)))
      }
    })
  }
}

describe('legacy physical worker authority router', () => {
  it('orders exact worker mutations and forwards pause to the imported delivery', async () => {
    const fixture = routerFixture()
    await fixture.router.attachReachablePty(attachRequest)
    let releaseFirst!: (value: unknown) => void
    fixture.rpc.mutationHandler
      .mockImplementationOnce(
        async () => await new Promise<unknown>((resolve) => (releaseFirst = resolve))
      )
      .mockResolvedValueOnce({ accepted: true })

    const first = fixture.router.dispatchMutation('pty-1', 'incarnation-1', {
      kind: 'signal',
      signal: 'SIGTERM'
    })
    const second = fixture.router.dispatchMutation('pty-1', 'incarnation-1', {
      kind: 'clear'
    })
    await vi.waitFor(() => expect(fixture.rpc.mutationHandler).toHaveBeenCalledTimes(1))
    releaseFirst({ accepted: true })
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(fixture.rpc.mutationHandler.mock.calls.map((call) => call[0])).toEqual([
      'pty.sendSignalExact',
      'pty.clearBufferExact'
    ])
    expect(fixture.registry.resolveExactPtyRoute).toHaveBeenCalledOnce()

    fixture.router.setDeliveryPaused(fixture.downstream.identity, true)
    fixture.router.setDeliveryPaused(fixture.downstream.identity, false)
    expect(
      fixture.rpc.notifications.filter((entry) => entry.method === 'pty.setDeliveryPaused')
    ).toEqual([
      {
        method: 'pty.setDeliveryPaused',
        params: expect.objectContaining({
          id: 'pty-1',
          deliveryToken: 'upstream-token:incarnation-1',
          paused: true
        })
      },
      {
        method: 'pty.setDeliveryPaused',
        params: expect.objectContaining({
          id: 'pty-1',
          deliveryToken: 'upstream-token:incarnation-1',
          paused: false
        })
      }
    ])
    await expect(
      fixture.router.setHeldProducerPause('pty-1', 'incarnation-1', 'held-1', true)
    ).resolves.toBe(true)
    expect(fixture.rpc.mutationHandler).toHaveBeenLastCalledWith(
      'pty.setDeliveryPaused',
      expect.objectContaining({
        id: 'pty-1',
        ptyIncarnationId: 'incarnation-1',
        heldPauseToken: 'held-1',
        paused: true
      })
    )
  })

  it('publishes output before exit and advances upstream only after durable downstream ACK', async () => {
    const fixture = routerFixture()
    const attached = await fixture.router.attachReachablePty(attachRequest)
    expect(attached).toEqual({
      incarnationId: 'incarnation-1',
      sourceActivation: fixture.downstream.sourceActivation
    })

    fixture.rpc.emit('pty.data', sourceSpan(0, 4, 'four'))
    fixture.rpc.emit('pty.exit', { id: 'pty-1', incarnationId: 'incarnation-1', code: 7 })
    expect(fixture.downstream.publications).toEqual(['data:4'])
    expect(fixture.rpc.acknowledgements).toEqual([])

    fixture.downstream.settleData({ ok: true })
    await vi.waitFor(() => expect(fixture.downstream.publications).toEqual(['data:4', 'exit:4']))
    fixture.downstream.settleExit({ ok: true })
    await vi.waitFor(() => expect(fixture.onExitSettled).toHaveBeenCalledWith(attachRequest, 7))
    expect(fixture.rpc.acknowledgements).toEqual([])

    fixture.downstream.creditedEndSu = 4
    fixture.router.handleDownstreamCredit(fixture.downstream.identity)
    await vi.waitFor(() => expect(fixture.rpc.acknowledgements).toHaveLength(1))
    expect(fixture.rpc.acknowledgements[0]).toMatchObject({
      id: 'pty-1',
      deliveryToken: 'upstream-token:incarnation-1',
      creditedEndSu: 4
    })
    expect(fixture.cursors.restore(bindingKey)?.checkpoint.creditedEndSu).toBe(4)
  })

  it('records an imported exit before publishing its stable authority outcome', async () => {
    let keepOutcomePending!: () => void
    const recordExit = vi.fn(
      async () => await new Promise<void>((resolve) => (keepOutcomePending = resolve))
    )
    const fixture = routerFixture({ recordExit })
    await fixture.router.attachReachablePty(attachRequest)
    fixture.rpc.emit('pty.exit', { id: 'pty-1', incarnationId: 'incarnation-1', code: 7 })
    await vi.waitFor(() => expect(recordExit).toHaveBeenCalledWith(attachRequest, 7))
    expect(fixture.downstream.publications).toEqual([])
    const authorityOutcome = importedExitOutcome()
    const effect = authorityOutcome.result.effects.find(
      (candidate) => candidate.kind === 'terminal-exited'
    )!
    const attempt = {
      identity: {
        version: 1 as const,
        namespace: authorityOutcome.result.namespace,
        pane: attachRequest.pane,
        binding: attachRequest.binding,
        consumerId: authorityOutcome.consumerId,
        outcomeId: authorityOutcome.outcomeId,
        sequence: authorityOutcome.sequence
      },
      supportsClient: () => true,
      markPublished: vi.fn(),
      markOrderedComplete: vi.fn()
    }

    expect(fixture.router.publishAuthorityOutcome(authorityOutcome, effect, attempt)).toBe(true)
    expect(fixture.downstream.publications).toEqual(['exit:0'])
    expect(attempt.markPublished).toHaveBeenCalledWith([1])
    fixture.downstream.settleExit({ ok: true })
    expect(attempt.markOrderedComplete).toHaveBeenCalledOnce()
    keepOutcomePending()
  })

  it('keeps duplicate attachment and disposal paths idempotent', async () => {
    const fixture = routerFixture()
    await fixture.router.attachReachablePty(attachRequest)
    const first = fixture.downstreams[0]
    await fixture.router.attachReachablePty(attachRequest)
    expect(first.dispose).not.toHaveBeenCalled()
    expect(fixture.downstreams).toHaveLength(1)

    fixture.router.dispose()
    fixture.router.dispose()
    expect(first.dispose).toHaveBeenCalledOnce()
    await expect(fixture.router.attachReachablePty(attachRequest)).rejects.toThrow(
      'authority router is disposed'
    )
  })

  it('routes owner-scoped ID collisions by exact public incarnation and rejects ambiguity', async () => {
    const fixture = routerFixture()
    await fixture.router.attachReachablePty(attachRequest)
    const second = attachRequestFor('legacy-owner-2', 'incarnation-2')
    await expect(fixture.router.attachReachablePty(second)).resolves.toMatchObject({
      incarnationId: 'incarnation-2'
    })
    expect(fixture.downstreams).toHaveLength(2)

    await expect(
      fixture.router.dispatchMutation('pty-1', 'incarnation-2', {
        kind: 'clear'
      })
    ).resolves.toBe(true)
    expect(fixture.rpc.mutationHandler).toHaveBeenCalledWith(
      'pty.clearBufferExact',
      expect.objectContaining({ id: 'pty-1', incarnationId: 'incarnation-2' })
    )

    await expect(
      fixture.router.attachReachablePty(attachRequestFor('legacy-owner-3', 'incarnation-1'))
    ).rejects.toThrow('public route identity is ambiguous')
  })

  it('rejects ID-only and post-exit mutations without probing inventory', async () => {
    const fixture = routerFixture()
    await fixture.router.attachReachablePty(attachRequest)

    await expect(
      fixture.router.dispatchMutation('pty-1', undefined as never, {
        kind: 'data',
        data: 'stale'
      })
    ).resolves.toBe(false)
    fixture.rpc.emit('pty.exit', {
      id: 'pty-1',
      incarnationId: 'incarnation-1',
      code: 0
    })
    await expect(
      fixture.router.dispatchMutation('pty-1', 'incarnation-1', {
        kind: 'data',
        data: 'after-exit'
      })
    ).resolves.toBe(false)
    expect(fixture.rpc.mutationHandler).not.toHaveBeenCalled()
    expect(fixture.registry.resolveExactPtyRoute).toHaveBeenCalledOnce()
  })

  it('persists an imported close before every exact physical shutdown attempt', async () => {
    const fixture = routerFixture()
    const events: string[] = []
    fixture.registry.dispatchPtyMutation.mockImplementation(async () => {
      events.push('physical-shutdown')
      return true
    })
    const access = {
      namespace: { authorityHostId: 'host-a', namespaceId: 'namespace-a' },
      pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
      binding: attachRequest.binding
    }

    const mutation = { kind: 'shutdown' as const, immediate: true, keepHistory: true }
    const persistClose = vi.fn(async () => {
      events.push('durable-close')
    })

    await expect(
      fixture.router.dispatchAuthorityShutdown(access, mutation, persistClose)
    ).resolves.toBe(true)
    await expect(
      fixture.router.dispatchAuthorityShutdown(access, mutation, persistClose)
    ).resolves.toBe(true)
    expect(events).toEqual([
      'durable-close',
      'physical-shutdown',
      'durable-close',
      'physical-shutdown'
    ])
    expect(fixture.registry.dispatchPtyMutation).toHaveBeenNthCalledWith(
      1,
      attachRequest.binding.ownerIncarnationId,
      {
        id: attachRequest.binding.physicalPtyId,
        incarnationId: attachRequest.binding.ptyIncarnationId
      },
      mutation
    )
  })

  it('re-ensures a committed shutdown without a second topology mutation', async () => {
    const fixture = routerFixture()
    const access = {
      namespace: { authorityHostId: 'host-a', namespaceId: 'namespace-a' },
      pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
      binding: attachRequest.binding
    }
    const mutation = { kind: 'shutdown' as const, immediate: true }

    await expect(fixture.router.ensureAuthorityShutdown(access, mutation)).resolves.toBe(true)
    expect(fixture.registry.dispatchPtyMutation).toHaveBeenCalledWith(
      attachRequest.binding.ownerIncarnationId,
      {
        id: attachRequest.binding.physicalPtyId,
        incarnationId: attachRequest.binding.ptyIncarnationId
      },
      mutation
    )

    fixture.registry.dispatchPtyMutation.mockRejectedValueOnce(new Error('lost response'))
    await expect(fixture.router.ensureAuthorityShutdown(access, mutation)).rejects.toThrow(
      'lost response'
    )
  })

  it('keeps thousands of imported writes on the captured O(1) route', async () => {
    const fixture = routerFixture()
    await fixture.router.attachReachablePty(attachRequest)

    await expect(
      Promise.all(
        Array.from({ length: 2_000 }, (_, index) =>
          fixture.router.dispatchMutation('pty-1', 'incarnation-1', {
            kind: 'data',
            data: String(index)
          })
        )
      )
    ).resolves.toEqual(Array.from({ length: 2_000 }, () => true))
    expect(fixture.registry.resolveExactPtyRoute).toHaveBeenCalledOnce()
    expect(
      fixture.rpc.notifications.filter((entry) => entry.method === 'pty.dataExact')
    ).toHaveLength(2_000)
  })

  it('revokes queued mutations and events when an exact route generation is superseded', async () => {
    const firstRpc = new WorkerRpc()
    const secondRpc = new WorkerRpc()
    const firstClient = workerClient(firstRpc)
    const secondClient = workerClient(secondRpc)
    let generation = 1
    let route: LegacyPhysicalWorkerExactRoute = Object.freeze({
      client: firstClient,
      generation: 1,
      isCurrent: () => generation === 1
    })
    const downstreams: ControlledDownstream[] = []
    const router = new LegacyPhysicalWorkerAuthorityRouter({
      registry: {
        resolveExactPtyRoute: async () => route,
        dispatchPtyMutation: async () => false,
        reservesPhysicalPtyId: () => false
      },
      downstream: {
        open: (input) => {
          const downstream = new ControlledDownstream(input.id, input.incarnationId)
          downstreams.push(downstream)
          return Object.freeze({ status: 'attached' as const, attachment: downstream })
        }
      },
      cursors: new MemoryLegacyPtyProxyCursorRepository()
    })
    await router.attachReachablePty(attachRequest)
    let releaseMutation!: () => void
    firstRpc.mutationHandler.mockImplementationOnce(
      async () =>
        await new Promise((resolve) => (releaseMutation = () => resolve({ accepted: true })))
    )
    const inFlight = router.dispatchMutation('pty-1', 'incarnation-1', { kind: 'clear' })
    const staleQueued = router.dispatchMutation('pty-1', 'incarnation-1', { kind: 'clear' })
    await vi.waitFor(() => expect(firstRpc.mutationHandler).toHaveBeenCalledOnce())

    generation = 2
    route = Object.freeze({
      client: secondClient,
      generation: 2,
      isCurrent: () => generation === 2
    })
    await expect(router.attachReachablePty(attachRequest)).resolves.toMatchObject({
      incarnationId: 'incarnation-1'
    })
    releaseMutation()
    await expect(inFlight).resolves.toBe(true)
    await expect(staleQueued).resolves.toBe(false)

    firstRpc.emit('pty.data', sourceSpan(0, 4, 'old!'))
    expect(downstreams[1].publications).toEqual([])
    secondRpc.emit('pty.data', sourceSpan(0, 4, 'new!'))
    expect(downstreams[1].publications).toEqual(['data:4'])
    expect(firstRpc.mutationHandler).toHaveBeenCalledOnce()
    expect(secondRpc.mutationHandler).not.toHaveBeenCalled()
  })
})

function routerFixture(options: { recordExit?: () => Promise<void> } = {}) {
  const rpc = new WorkerRpc()
  const client = workerClient(rpc)
  const route = Object.freeze({ client, generation: 1, isCurrent: () => true })
  const registry = {
    resolveExactPtyRoute: vi.fn(async () => route),
    dispatchPtyMutation: vi.fn(async () => true),
    reservesPhysicalPtyId: vi.fn(() => false)
  }
  const downstreams: ControlledDownstream[] = []
  const cursors = new MemoryLegacyPtyProxyCursorRepository()
  const onExitSettled = vi.fn(async () => {})
  const router = new LegacyPhysicalWorkerAuthorityRouter({
    registry,
    downstream: {
      open: (input) => {
        const downstream = new ControlledDownstream(input.id, input.incarnationId)
        downstreams.push(downstream)
        return Object.freeze({ status: 'attached' as const, attachment: downstream })
      }
    },
    cursors,
    onExitSettled,
    ...(options.recordExit ? { recordExit: options.recordExit } : {})
  })
  return {
    router,
    rpc,
    registry,
    downstreams,
    get downstream(): ControlledDownstream {
      const downstream = downstreams.at(-1)
      if (!downstream) {
        throw new Error('downstream was not opened')
      }
      return downstream
    },
    cursors,
    onExitSettled
  }
}

class ControlledDownstream implements LegacyPhysicalWorkerDownstreamAttachment {
  readonly publications: string[] = []
  readonly sourceActivation: PtySourceReceivingActivation
  readonly dispose = vi.fn()
  readonly identity
  creditedEndSu = 0
  private dataSettlement: ((result: SinkWriteSettlement) => void) | null = null
  private exitSettlement: ((result: SinkWriteSettlement) => void) | null = null

  constructor(id: string, incarnationId: string) {
    const deliveryToken = `downstream-token:${incarnationId}`
    this.sourceActivation = Object.freeze({
      status: 'pending',
      clientGeneration: 5,
      ownerGeneration: 6,
      ptyIncarnation: incarnationId,
      deliveryToken,
      checkpointSourceEndSu: 0,
      recoveryEndSu: 0
    })
    this.identity = Object.freeze({
      id,
      providerGeneration: 1,
      clientGeneration: 5,
      ownerGeneration: 6,
      ptyIncarnation: incarnationId,
      deliveryToken
    })
  }

  publishData(span: PtySourceSpan, onSettled: (result: SinkWriteSettlement) => void): boolean {
    this.publications.push(`data:${span.sourceEndSu}`)
    this.dataSettlement = onSettled
    return true
  }

  publishExit(exit: LegacyPtyProxyExit, onSettled: (result: SinkWriteSettlement) => void): boolean {
    this.publications.push(`exit:${exit.sourceEndSu}`)
    if (exit.authorityOutcome?.supportsClient(1)) {
      exit.authorityOutcome.markPublished([1])
    }
    this.exitSettlement = (result) => {
      onSettled(result)
      if (result.ok) {
        exit.authorityOutcome?.markOrderedComplete()
      }
    }
    return true
  }

  acknowledgedEndSu(): number {
    return this.creditedEndSu
  }

  onCreditAvailable(): void {}

  reopen(): null {
    return null
  }

  settleData(result: SinkWriteSettlement): void {
    this.dataSettlement?.(result)
  }

  settleExit(result: SinkWriteSettlement): void {
    this.exitSettlement?.(result)
  }
}

class WorkerRpc implements LegacyPhysicalWorkerRpc {
  readonly notifications: { method: string; params: Record<string, unknown> }[] = []
  readonly acknowledgements: Record<string, unknown>[] = []
  readonly mutationHandler = vi.fn<
    (method: string, params: Record<string, unknown>) => Promise<unknown>
  >(async (method) => (method === 'pty.setDeliveryPaused' ? { applied: true } : { accepted: true }))
  private readonly notificationListeners = new Set<
    (method: string, params: Record<string, unknown>) => void
  >()

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method !== 'pty.attach') {
      return await this.mutationHandler(method, params)
    }
    return {
      incarnationId: params.expectedIncarnationId,
      sourceActivation: {
        status: 'pending',
        clientGeneration: 2,
        ownerGeneration: 3,
        ptyIncarnation: params.expectedIncarnationId,
        deliveryToken: `upstream-token:${String(params.expectedIncarnationId)}`,
        checkpointSourceEndSu: 0,
        recoveryEndSu: 0
      }
    }
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.notifications.push({ method, params })
  }

  notifyWithSettlement(
    method: string,
    params: Record<string, unknown>,
    onSettled: (result: SinkWriteSettlement) => void
  ): void {
    if (method === 'pty.ackData') {
      this.acknowledgements.push(
        ...((params.acknowledgements as Record<string, unknown>[] | undefined) ?? [])
      )
    }
    onSettled({ ok: true })
  }

  onNotification(listener: (method: string, params: Record<string, unknown>) => void): () => void {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  isOpen(): boolean {
    return true
  }

  onClose(): () => void {
    return () => {}
  }

  close(): void {}

  emit(method: string, params: Record<string, unknown>): void {
    this.notificationListeners.forEach((listener) => listener(method, params))
  }
}

function workerClient(rpc: LegacyPhysicalWorkerRpc): LegacyPhysicalWorkerClient {
  return new LegacyPhysicalWorkerClient(
    rpc,
    {
      protocolVersion: 1,
      serverBuildId: 'build-1',
      clientGeneration: 2,
      role: 'session-owner',
      ownerGeneration: 3,
      ownerLease: 'lease-1',
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

function sourceSpan(
  sourceStartSu: number,
  sourceEndSu: number,
  data: string
): Record<string, unknown> {
  return {
    id: 'pty-1',
    providerGeneration: 1,
    clientGeneration: 2,
    ownerGeneration: 3,
    ptyIncarnation: 'incarnation-1',
    deliveryToken: 'upstream-token:incarnation-1',
    spanId: `span-${sourceEndSu}`,
    sourceStartSu,
    sourceEndSu,
    displayStart: sourceStartSu,
    displayEnd: sourceEndSu,
    data,
    splittable: true,
    transform: { transformed: false, rawLengthSu: sourceEndSu - sourceStartSu, scalarSafe: true }
  }
}

function importedExitOutcome() {
  const request = {
    actorId: 'actor-1',
    operationId: 'operation-1',
    baseRevision: 1,
    consumerId: 'consumer-1',
    outcomeId: 'outcome-1',
    change: {
      kind: 'exit' as const,
      pane: attachRequest.pane,
      expected: {
        paneGenerationId: attachRequest.pane.paneGenerationId,
        binding: attachRequest.binding
      },
      exit: { code: 7, signal: null }
    }
  }
  return {
    consumerId: request.consumerId,
    sequence: 1,
    outcomeId: request.outcomeId,
    request,
    result: {
      namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
      actorId: request.actorId,
      operationId: request.operationId,
      kind: 'exit' as const,
      revision: 2,
      pane: {
        paneKey: attachRequest.pane.paneKey,
        paneGenerationId: attachRequest.pane.paneGenerationId,
        status: 'exited' as const,
        binding: null,
        lastBinding: attachRequest.binding,
        revision: 2
      },
      replacementPane: null,
      allocation: null,
      effects: [
        {
          kind: 'binding-retired' as const,
          reason: 'exit' as const,
          binding: attachRequest.binding
        },
        {
          kind: 'terminal-exited' as const,
          binding: attachRequest.binding,
          code: 7,
          signal: null
        }
      ]
    },
    byteLength: 1
  }
}

const attachRequest: LegacyPhysicalWorkerAttachRequest = Object.freeze({
  pane: Object.freeze({ paneKey: 'pane-1', paneGenerationId: 'pane-generation-1' }),
  binding: Object.freeze({
    ownerIncarnationId: 'legacy-owner-1',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: 'incarnation-1'
  }),
  worktreeId: 'repo-1::/workspace',
  suppressReplayNotification: true
})

function attachRequestFor(
  ownerIncarnationId: string,
  ptyIncarnationId: string
): LegacyPhysicalWorkerAttachRequest {
  return Object.freeze({
    ...attachRequest,
    pane: Object.freeze({
      paneKey: `pane-${ownerIncarnationId}`,
      paneGenerationId: `pane-generation-${ownerIncarnationId}`
    }),
    binding: Object.freeze({
      ownerIncarnationId,
      physicalPtyId: 'pty-1',
      ptyIncarnationId
    })
  })
}

const bindingKey = JSON.stringify(['legacy-owner-1', 'pty-1', 'incarnation-1'])
