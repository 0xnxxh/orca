import type {
  PtySourceCreditAck,
  PtySourceDeliveryIdentity,
  PtySourceSpan
} from '../shared/pty-source-credit-contract'
import {
  LegacyPtyProxyCursor,
  type LegacyPtyProxyCheckpointStore,
  type LegacyPtyProxyRestoredCursor
} from './legacy-pty-proxy-cursor'
import {
  LEGACY_PTY_PROXY_MAX_FRAMES,
  LEGACY_PTY_PROXY_MAX_RETAINED_BYTES,
  type LegacyPtyProxyDownstreamSettlement,
  type LegacyPtyProxyExit,
  type LegacyPtyProxySink
} from './legacy-pty-proxy-contract'

export type {
  LegacyPtyProxyCheckpointStore,
  LegacyPtyProxyCursorCheckpoint,
  LegacyPtyProxyRestoredCursor
} from './legacy-pty-proxy-cursor'
export {
  LEGACY_PTY_PROXY_MAX_FRAMES,
  LEGACY_PTY_PROXY_MAX_RETAINED_BYTES,
  type LegacyPtyProxyExit,
  type LegacyPtyProxySink
} from './legacy-pty-proxy-contract'

type ProxyDataRecord = {
  span: PtySourceSpan
  bytes: number
  state: 'queued' | 'sending' | 'published'
}

type ProxyExitRecord = {
  exit: LegacyPtyProxyExit
  state: 'queued' | 'sending' | 'published'
}

export class OrderedLegacyPtyProxy {
  private readonly queue: ProxyDataRecord[] = []
  private exit: ProxyExitRecord | null = null
  private receivedEndSu: number
  private publishedEndSu: number
  private readonly cursor: LegacyPtyProxyCursor
  private retainedBytes = 0
  private disposed = false
  private failed = false

  constructor(
    private readonly identity: PtySourceDeliveryIdentity,
    private readonly sink: LegacyPtyProxySink,
    checkpointStore: LegacyPtyProxyCheckpointStore,
    publishUpstreamAck: (ack: PtySourceCreditAck, acknowledgementId: string) => Promise<void>,
    private readonly limits: Readonly<{
      maxRetainedBytes: number
      maxFrames: number
    }> = {
      maxRetainedBytes: LEGACY_PTY_PROXY_MAX_RETAINED_BYTES,
      maxFrames: LEGACY_PTY_PROXY_MAX_FRAMES
    },
    checkpointSourceEndSu = 0,
    restoredCursor?: LegacyPtyProxyRestoredCursor
  ) {
    if (
      !Number.isSafeInteger(checkpointSourceEndSu) ||
      checkpointSourceEndSu < 0 ||
      !Number.isSafeInteger(limits.maxRetainedBytes) ||
      limits.maxRetainedBytes < 1 ||
      !Number.isSafeInteger(limits.maxFrames) ||
      limits.maxFrames < 1
    ) {
      throw new Error('legacy PTY proxy limits are invalid')
    }
    this.cursor = new LegacyPtyProxyCursor(
      identity,
      checkpointSourceEndSu,
      restoredCursor,
      checkpointStore,
      async (ack, acknowledgementId) => {
        if (this.disposed) {
          throw new Error('legacy PTY proxy closed after cursor commit')
        }
        await publishUpstreamAck(ack, acknowledgementId)
      }
    )
    const downstreamEndSu = this.cursor.downstreamAckedEndSu
    this.receivedEndSu = downstreamEndSu
    this.publishedEndSu = downstreamEndSu
  }

  acceptData(span: PtySourceSpan): boolean {
    this.assertActive()
    this.assertIdentity(span)
    if (this.exit) {
      return this.fail('legacy PTY proxy received data after exit')
    }
    if (span.sourceEndSu <= this.cursor.downstreamAckedEndSu) {
      void this.retryDurableUpstreamAck().catch(() => {})
      return true
    }
    if (
      span.sourceStartSu !== this.receivedEndSu ||
      !Number.isSafeInteger(span.sourceEndSu) ||
      span.sourceEndSu <= span.sourceStartSu
    ) {
      return this.fail('legacy PTY proxy source sequence is not contiguous')
    }
    const bytes = Buffer.byteLength(span.data)
    if (
      bytes < 1 ||
      this.queue.length >= this.limits.maxFrames ||
      this.retainedBytes + bytes > this.limits.maxRetainedBytes
    ) {
      return this.fail('legacy PTY proxy retention capacity exceeded')
    }
    this.queue.push({ span: Object.freeze({ ...span }), bytes, state: 'queued' })
    this.retainedBytes += bytes
    this.receivedEndSu = span.sourceEndSu
    this.pump()
    return true
  }

  acceptExit(exit: Omit<LegacyPtyProxyExit, 'sourceEndSu'>): boolean {
    this.assertActive()
    if (
      exit.id !== this.identity.id ||
      exit.incarnationId !== this.identity.ptyIncarnation ||
      !Number.isSafeInteger(exit.code)
    ) {
      return this.fail('legacy PTY proxy exit identity is invalid')
    }
    if (this.exit) {
      return this.exit.exit.code === exit.code
        ? true
        : this.fail('legacy PTY proxy exit changed after sealing')
    }
    this.exit = {
      exit: Object.freeze({ ...exit, sourceEndSu: this.receivedEndSu }),
      state: 'queued'
    }
    this.pump()
    return true
  }

  acknowledgeDownstream(creditedEndSu: number): Promise<void> {
    this.assertActive()
    if (
      !Number.isSafeInteger(creditedEndSu) ||
      creditedEndSu < 0 ||
      creditedEndSu > this.publishedEndSu ||
      (creditedEndSu > this.cursor.downstreamAckedEndSu &&
        !this.queue.some(
          (record) => record.state === 'published' && record.span.sourceEndSu === creditedEndSu
        ))
    ) {
      this.fail('legacy PTY proxy downstream ACK is invalid')
    }
    return this.cursor.acknowledge(creditedEndSu).finally(() => this.releaseAcknowledgedData())
  }

  retryDurableUpstreamAck(): Promise<void> {
    this.assertActive()
    return this.cursor.retry().finally(() => this.releaseAcknowledgedData())
  }

  onDownstreamCapacity(): void {
    if (!this.disposed && !this.failed) {
      this.pump()
    }
  }

  retryDownstreamExit(): void {
    this.assertActive()
    if (this.exit && this.exit.state === 'published') {
      this.exit.state = 'queued'
    }
    this.pump()
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.queue.length = 0
    this.exit = null
    this.retainedBytes = 0
  }

  snapshot(): Readonly<{
    receivedEndSu: number
    publishedEndSu: number
    downstreamAckedEndSu: number
    upstreamAckedEndSu: number
    retainedBytes: number
    retainedFrames: number
    exitState: ProxyExitRecord['state'] | null
    failed: boolean
    disposed: boolean
  }> {
    return Object.freeze({
      receivedEndSu: this.receivedEndSu,
      publishedEndSu: this.publishedEndSu,
      downstreamAckedEndSu: this.cursor.downstreamAckedEndSu,
      upstreamAckedEndSu: this.cursor.upstreamAckedEndSu,
      retainedBytes: this.retainedBytes,
      retainedFrames: this.queue.length,
      exitState: this.exit?.state ?? null,
      failed: this.failed,
      disposed: this.disposed
    })
  }

  private pump(): void {
    if (this.disposed || this.failed || this.queue.some((record) => record.state === 'sending')) {
      return
    }
    const next = this.queue.find((record) => record.state === 'queued')
    if (next) {
      next.state = 'sending'
      let callbackRan = false
      const admitted = this.sink.publishData(
        next.span,
        onceSettlement((settlement) => {
          callbackRan = true
          if (this.disposed || this.failed) {
            return
          }
          if (!settlement.ok) {
            next.state = 'queued'
            return
          }
          next.state = 'published'
          this.publishedEndSu = Math.max(this.publishedEndSu, next.span.sourceEndSu)
          queueMicrotask(() => this.pump())
        })
      )
      if (!admitted && !callbackRan) {
        next.state = 'queued'
      }
      return
    }
    if (!this.exit || this.exit.state !== 'queued') {
      return
    }
    this.exit.state = 'sending'
    const exitRecord = this.exit
    let callbackRan = false
    const admitted = this.sink.publishExit(
      exitRecord.exit,
      onceSettlement((settlement) => {
        callbackRan = true
        if (this.disposed || this.failed || this.exit !== exitRecord) {
          return
        }
        exitRecord.state = settlement.ok ? 'published' : 'queued'
      })
    )
    if (!admitted && !callbackRan) {
      exitRecord.state = 'queued'
    }
  }

  private releaseAcknowledgedData(): void {
    while (
      this.queue[0]?.state === 'published' &&
      this.queue[0].span.sourceEndSu <= this.cursor.downstreamAckedEndSu
    ) {
      this.retainedBytes -= this.queue.shift()!.bytes
    }
  }

  private assertIdentity(span: PtySourceSpan): void {
    if (
      span.id !== this.identity.id ||
      span.providerGeneration !== this.identity.providerGeneration ||
      span.clientGeneration !== this.identity.clientGeneration ||
      span.ownerGeneration !== this.identity.ownerGeneration ||
      span.ptyIncarnation !== this.identity.ptyIncarnation ||
      span.deliveryToken !== this.identity.deliveryToken
    ) {
      this.fail('legacy PTY proxy source identity is stale')
    }
  }

  private assertActive(): void {
    if (this.disposed || this.failed) {
      throw new Error('legacy PTY proxy is closed')
    }
  }

  private fail(message: string): false {
    this.failed = true
    throw new Error(message)
  }
}

function onceSettlement(
  listener: (settlement: LegacyPtyProxyDownstreamSettlement) => void
): (settlement: LegacyPtyProxyDownstreamSettlement) => void {
  let settled = false
  return (result) => {
    if (settled) {
      return
    }
    settled = true
    listener(result)
  }
}
