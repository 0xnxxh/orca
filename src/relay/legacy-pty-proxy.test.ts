import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PtySourceDeliveryIdentity, PtySourceSpan } from '../shared/pty-source-credit-contract'
import {
  LegacyPhysicalWorkerClient,
  type LegacyPhysicalWorkerRpc
} from './legacy-physical-worker-client'
import {
  OrderedLegacyPtyProxy,
  type LegacyPtyProxyCursorCheckpoint,
  type LegacyPtyProxyExit,
  type LegacyPtyProxySink
} from './legacy-pty-proxy'
import { LegacyPtyProxyCursor } from './legacy-pty-proxy-cursor'

const identity: PtySourceDeliveryIdentity = Object.freeze({
  id: 'pty-1',
  providerGeneration: 1,
  clientGeneration: 2,
  ownerGeneration: 3,
  ptyIncarnation: 'incarnation-1',
  deliveryToken: 'delivery-1'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ordered legacy PTY proxy', () => {
  it('publishes data then exit and ACKs upstream only from cumulative downstream ACK', async () => {
    vi.useFakeTimers()
    const sink = new ControlledSink()
    const upstreamAcks: number[] = []
    const order: string[] = []
    const checkpoints = new MemoryCheckpointStore(order)
    const proxy = new OrderedLegacyPtyProxy(identity, sink, checkpoints, async (ack) => {
      order.push(`upstream:${ack.creditedEndSu}`)
      upstreamAcks.push(ack.creditedEndSu)
    })

    proxy.acceptData(sourceSpan('span-1', 0, 4, 'one!'))
    proxy.acceptData(sourceSpan('span-2', 4, 8, 'two!'))
    proxy.acceptExit({ id: 'pty-1', incarnationId: 'incarnation-1', code: 0 })
    expect(sink.publications).toEqual(['data:span-1'])
    expect(upstreamAcks).toEqual([])

    sink.settleData(0, { ok: true })
    await Promise.resolve()
    expect(sink.publications).toEqual(['data:span-1', 'data:span-2'])
    sink.settleData(1, { ok: true })
    await Promise.resolve()
    expect(sink.publications).toEqual(['data:span-1', 'data:span-2', 'exit:8'])
    expect(upstreamAcks).toEqual([])

    await vi.advanceTimersByTimeAsync(60_000)
    expect(upstreamAcks).toEqual([])
    await proxy.acknowledgeDownstream(4)
    await proxy.acknowledgeDownstream(4)
    await proxy.acknowledgeDownstream(8)
    expect(upstreamAcks).toEqual([4, 8])
    expect(order).toEqual(['checkpoint:4', 'upstream:4', 'checkpoint:8', 'upstream:8'])
    expect(proxy.snapshot()).toMatchObject({
      retainedBytes: 0,
      retainedFrames: 0,
      downstreamAckedEndSu: 8,
      upstreamAckedEndSu: 8,
      exitState: 'sending'
    })
    sink.settleExit({ ok: true })
    expect(proxy.snapshot().exitState).toBe('published')
  })

  it('retains bounded data across downstream backpressure without early ACK', async () => {
    const sink = new ControlledSink()
    sink.admitData = false
    const upstreamAck = vi.fn(async () => {})
    const proxy = new OrderedLegacyPtyProxy(
      identity,
      sink,
      new MemoryCheckpointStore(),
      upstreamAck,
      {
        maxRetainedBytes: 8,
        maxFrames: 2
      }
    )

    expect(proxy.acceptData(sourceSpan('span-1', 0, 4, 'four'))).toBe(true)
    expect(proxy.snapshot()).toMatchObject({ retainedBytes: 4, retainedFrames: 1 })
    expect(upstreamAck).not.toHaveBeenCalled()
    sink.admitData = true
    proxy.onDownstreamCapacity()
    expect(sink.publications).toEqual(['data:span-1'])
    sink.settleData(0, { ok: false, error: new Error('closed sink') })
    proxy.onDownstreamCapacity()
    expect(sink.publications).toEqual(['data:span-1', 'data:span-1'])
    sink.settleData(1, { ok: true })
    await Promise.resolve()
    expect(upstreamAck).not.toHaveBeenCalled()
    await proxy.acknowledgeDownstream(4)
    expect(upstreamAck).toHaveBeenCalledTimes(1)
  })

  it('fails closed at its retention bound without ACK or liveness fallback', () => {
    const sink = new ControlledSink()
    sink.admitData = false
    const upstreamAck = vi.fn(async () => {})
    const proxy = new OrderedLegacyPtyProxy(
      identity,
      sink,
      new MemoryCheckpointStore(),
      upstreamAck,
      {
        maxRetainedBytes: 4,
        maxFrames: 1
      }
    )
    proxy.acceptData(sourceSpan('span-1', 0, 4, 'four'))
    expect(() => proxy.acceptData(sourceSpan('span-2', 4, 8, 'more'))).toThrow(
      'retention capacity exceeded'
    )
    expect(proxy.snapshot()).toMatchObject({ failed: true, retainedBytes: 4 })
    expect(upstreamAck).not.toHaveBeenCalled()
  })

  it('recovers a crash after durable cursor commit with the same ACK identity', async () => {
    const sink = new ControlledSink()
    const store = new MemoryCheckpointStore()
    const acknowledgementIds: string[] = []
    const rpc = new SettlementWorkerRpc()
    const worker = settlementWorker(rpc)
    const publish = async (
      ack: Parameters<typeof worker.publishSourceAcknowledgement>[0],
      acknowledgementId: string
    ) => {
      acknowledgementIds.push(acknowledgementId)
      await worker.publishSourceAcknowledgement(ack, acknowledgementId)
    }
    const proxy = new OrderedLegacyPtyProxy(identity, sink, store, publish)
    proxy.acceptData(sourceSpan('span-1', 0, 4, 'four'))
    sink.settleData(0, { ok: true })
    const firstPublication = proxy.acknowledgeDownstream(4)
    await vi.waitFor(() => expect(rpc.publications).toHaveLength(1))
    expect(store.checkpoints).toHaveLength(1)
    rpc.settle(0, { ok: false, error: new Error('crash after cursor commit') })
    await expect(firstPublication).rejects.toThrow('crash after cursor commit')
    expect(proxy.snapshot()).toMatchObject({
      downstreamAckedEndSu: 4,
      upstreamAckedEndSu: 0
    })
    proxy.dispose()

    const recovered = new OrderedLegacyPtyProxy(
      identity,
      new ControlledSink(),
      store,
      publish,
      undefined,
      0,
      { durableDownstreamAckedEndSu: 4, upstreamAckedEndSu: 0 }
    )
    const retry = recovered.retryDurableUpstreamAck()
    await vi.waitFor(() => expect(rpc.publications).toHaveLength(2))
    rpc.settle(1, { ok: true })
    await retry
    expect(acknowledgementIds[0]).toBe(acknowledgementIds[1])
    expect(rpc.publications[0]).toEqual(rpc.publications[1])
    expect(recovered.snapshot().upstreamAckedEndSu).toBe(4)
  })

  it('coalesces thousands of cumulative cursor advances before durable publication', async () => {
    const checkpoints: LegacyPtyProxyCursorCheckpoint[] = []
    const upstream: number[] = []
    const cursor = new LegacyPtyProxyCursor(
      identity,
      0,
      undefined,
      { commit: async (checkpoint) => void checkpoints.push(checkpoint) },
      async (ack) => void upstream.push(ack.creditedEndSu)
    )

    const advances = Array.from({ length: 2_000 }, (_, index) => cursor.acknowledge(index + 1))
    expect(new Set(advances).size).toBe(1)
    await Promise.all(advances)
    expect(checkpoints.map((checkpoint) => checkpoint.creditedEndSu)).toEqual([2_000])
    expect(upstream).toEqual([2_000])
  })

  it('makes duplicate exit and disposal paths idempotent', () => {
    const sink = new ControlledSink()
    const proxy = new OrderedLegacyPtyProxy(
      identity,
      sink,
      new MemoryCheckpointStore(),
      async () => {}
    )
    expect(proxy.acceptExit({ id: 'pty-1', incarnationId: 'incarnation-1', code: 9 })).toBe(true)
    expect(proxy.acceptExit({ id: 'pty-1', incarnationId: 'incarnation-1', code: 9 })).toBe(true)
    expect(sink.publications).toEqual(['exit:0'])
    proxy.dispose()
    proxy.dispose()
    expect(proxy.snapshot()).toMatchObject({ disposed: true, retainedFrames: 0 })
    expect(() => proxy.acknowledgeDownstream(0)).toThrow('proxy is closed')
  })

  it('rejects stale delivery identity and noncontiguous frames', () => {
    const proxy = new OrderedLegacyPtyProxy(
      identity,
      new ControlledSink(),
      new MemoryCheckpointStore(),
      async () => {}
    )
    expect(() =>
      proxy.acceptData({ ...sourceSpan('span-1', 0, 4, 'four'), deliveryToken: 'stale' })
    ).toThrow('source identity is stale')

    const second = new OrderedLegacyPtyProxy(
      identity,
      new ControlledSink(),
      new MemoryCheckpointStore(),
      async () => {}
    )
    expect(() => second.acceptData(sourceSpan('span-2', 2, 4, 'xx'))).toThrow(
      'source sequence is not contiguous'
    )
  })
})

class ControlledSink implements LegacyPtyProxySink {
  readonly publications: string[] = []
  private readonly dataSettlements: ((result: SinkSettlement) => void)[] = []
  private exitSettlement: ((result: SinkSettlement) => void) | null = null
  admitData = true
  admitExit = true

  publishData(span: PtySourceSpan, onSettled: (result: SinkSettlement) => void): boolean {
    if (!this.admitData) {
      return false
    }
    this.publications.push(`data:${span.spanId}`)
    this.dataSettlements.push(onSettled)
    return true
  }

  publishExit(exit: LegacyPtyProxyExit, onSettled: (result: SinkSettlement) => void): boolean {
    if (!this.admitExit) {
      return false
    }
    this.publications.push(`exit:${exit.sourceEndSu}`)
    this.exitSettlement = onSettled
    return true
  }

  settleData(index: number, result: SinkSettlement): void {
    this.dataSettlements[index](result)
  }

  settleExit(result: SinkSettlement): void {
    this.exitSettlement?.(result)
  }
}

type SinkSettlement = Readonly<{ ok: true }> | Readonly<{ ok: false; error: Error }>

class MemoryCheckpointStore {
  readonly checkpoints: LegacyPtyProxyCursorCheckpoint[] = []

  constructor(private readonly order: string[] = []) {}

  async commit(checkpoint: LegacyPtyProxyCursorCheckpoint): Promise<void> {
    const previous = this.checkpoints.at(-1)
    if (previous && checkpoint.creditedEndSu < previous.creditedEndSu) {
      throw new Error('checkpoint regression')
    }
    this.order.push(`checkpoint:${checkpoint.creditedEndSu}`)
    this.checkpoints.push(checkpoint)
  }
}

class SettlementWorkerRpc implements LegacyPhysicalWorkerRpc {
  readonly publications: { method: string; params: Record<string, unknown> }[] = []
  private readonly settlements: ((
    result: Readonly<{ ok: true }> | Readonly<{ ok: false; error: Error }>
  ) => void)[] = []

  request(): Promise<unknown> {
    return Promise.reject(new Error('unexpected request'))
  }

  notify(): void {
    throw new Error('unsettled notification is forbidden')
  }

  notifyWithSettlement(
    method: string,
    params: Record<string, unknown>,
    onSettled: (result: { ok: true } | { ok: false; error: Error }) => void
  ): void {
    this.publications.push({ method, params })
    this.settlements.push(onSettled)
  }

  onNotification(): () => void {
    return () => {}
  }

  isOpen(): boolean {
    return true
  }

  onClose(): () => void {
    return () => {}
  }

  close(): void {}

  settle(index: number, result: { ok: true } | { ok: false; error: Error }): void {
    this.settlements[index](result)
  }
}

function settlementWorker(rpc: LegacyPhysicalWorkerRpc): LegacyPhysicalWorkerClient {
  return new LegacyPhysicalWorkerClient(
    rpc,
    {
      protocolVersion: 1,
      serverBuildId: 'build-a',
      clientGeneration: 2,
      role: 'session-owner',
      ownerGeneration: 3,
      ownerLease: 'owner-lease',
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
  spanId: string,
  sourceStartSu: number,
  sourceEndSu: number,
  data: string
): PtySourceSpan {
  return Object.freeze({
    ...identity,
    spanId,
    sourceStartSu,
    sourceEndSu,
    displayStart: sourceStartSu,
    displayEnd: sourceEndSu,
    data,
    splittable: true,
    transform: { transformed: false, rawLengthSu: sourceEndSu - sourceStartSu, scalarSafe: true }
  })
}
