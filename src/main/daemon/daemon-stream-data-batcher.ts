import type { Socket } from 'node:net'
import { NDJSON_MAX_LINE_BYTES } from './ndjson'
import {
  flushDaemonStreamData,
  writeDaemonStreamControl,
  type DaemonStreamDataFlushArguments
} from './daemon-stream-data-flush'
import { flushDaemonStreamSession } from './daemon-stream-session-flush'
import type { PendingStreamDataBatch } from './daemon-stream-keep-tail-drop'
import type { DaemonEvent } from './types'
import type { PtyStreamSource } from '../../shared/pty-stream-binding-protocol'
import { appendDaemonStreamData, type DaemonStreamEnqueueOptions } from './daemon-stream-data-entry'
import {
  evaluateDroppableEnqueue,
  refreshDroppableSessionMembership
} from './daemon-stream-droppable-membership'

type StreamDataClient = {
  streamSocket: Socket | null
}

// 2ms: each chunk waits a half-window here AND again in main's PTY batch; a smaller interval still coalesces bursts while cutting the fixed latency tax (~8ms of the measured ~19ms DSR-under-load latency).
const STREAM_DATA_BATCH_INTERVAL_MS = 2

type DaemonStreamDataBatcherOptions = {
  maxLineBytes?: number
  /** Fires after each stream-socket write — the only place backlog grows, so the backlog pacer checks its watermark here. */
  onAfterSocketWrite?: () => void
  /** True for sessions whose queued output may be keep-tail dropped (main-marked background sessions). */
  isSessionDroppable?: (sessionId: string) => boolean
  /** Carve reply-eliciting query bytes (DSR/DA/DECRQM/OSC probes) out of dropped data — the hidden program blocks on the reply, so they must still be delivered even when their flood is not. */
  salvageDroppedData?: (dropped: string) => string
}

export class DaemonStreamDataBatcher {
  private pendingByClient = new Map<string, PendingStreamDataBatch>()
  private pendingSettlementsByClient = new Map<string, Set<(error: Error | null) => void>>()
  private getClient: (clientId: string) => StreamDataClient | undefined
  private maxLineBytes: number
  private onAfterSocketWrite: (() => void) | undefined
  private isSessionDroppable: (sessionId: string) => boolean
  private salvageDroppedData: (dropped: string) => string

  constructor(
    getClient: (clientId: string) => StreamDataClient | undefined,
    options: DaemonStreamDataBatcherOptions = {}
  ) {
    this.getClient = getClient
    this.maxLineBytes = Math.max(1, options.maxLineBytes ?? NDJSON_MAX_LINE_BYTES)
    this.onAfterSocketWrite = options.onAfterSocketWrite
    this.isSessionDroppable = options.isSessionDroppable ?? (() => false)
    this.salvageDroppedData = options.salvageDroppedData ?? (() => '')
  }

  enqueue(
    clientId: string,
    sessionId: string,
    data: string,
    options: DaemonStreamEnqueueOptions = {}
  ): void {
    const client = this.getClient(clientId)
    if (!client?.streamSocket || client.streamSocket.destroyed) {
      return
    }

    const batch = this.getOrCreateBatch(clientId)
    const queuedAfter = appendDaemonStreamData(batch, sessionId, data, options)
    const queuedBefore = queuedAfter - data.length
    evaluateDroppableEnqueue(
      batch,
      sessionId,
      queuedBefore,
      queuedAfter,
      this.isSessionDroppable,
      this.salvageDroppedData
    )

    if (
      options.flushImmediately === true &&
      (batch.queuedCharsBySession.get(sessionId) ?? 0) <=
        (options.flushMaxChars ?? Number.POSITIVE_INFINITY)
    ) {
      this.flushSession(clientId, sessionId)
      return
    }
    if (!batch.timer) {
      batch.timer = setTimeout(() => this.flush(clientId), STREAM_DATA_BATCH_INTERVAL_MS)
    }
  }

  /** Append a pre-shaped stream event at the current position in the session's byte order (scan handoff markers, gaps, transient facts). */
  enqueueControlEvent(clientId: string, sessionId: string, control: DaemonEvent): void {
    const client = this.getClient(clientId)
    if (!client?.streamSocket || client.streamSocket.destroyed) {
      return
    }
    const batch = this.getOrCreateBatch(clientId)
    batch.queue.push({ sessionId, data: '', control })
    if (!batch.timer) {
      batch.timer = setTimeout(() => this.flush(clientId), STREAM_DATA_BATCH_INTERVAL_MS)
    }
  }

  enqueueSettledControlEvent(
    clientId: string,
    sessionId: string,
    control: DaemonEvent
  ): Promise<void> {
    const client = this.getClient(clientId)
    if (!client?.streamSocket || client.streamSocket.destroyed) {
      return Promise.reject(new Error('daemon stream consumer is unavailable'))
    }
    return new Promise<void>((resolve, reject) => {
      const batch = this.getOrCreateBatch(clientId)
      const pending = this.pendingSettlementsByClient.get(clientId) ?? new Set()
      let settled = false
      const settle = (error: Error | null): void => {
        if (settled) {
          return
        }
        settled = true
        pending.delete(settle)
        if (pending.size === 0) {
          this.pendingSettlementsByClient.delete(clientId)
        }
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }
      pending.add(settle)
      this.pendingSettlementsByClient.set(clientId, pending)
      batch.queue.push({
        sessionId,
        data: '',
        control,
        settle
      })
      this.flushSession(clientId, sessionId)
    })
  }

  establishSessionSource(clientId: string, sessionId: string, source: PtyStreamSource): void {
    this.flushSession(clientId, sessionId)
    this.enqueueControlEvent(clientId, sessionId, {
      type: 'event',
      event: 'sessionSource',
      sessionId,
      payload: source
    })
  }

  refreshSessionDroppability(sessionId: string): void {
    const droppable = this.isSessionDroppable(sessionId)
    refreshDroppableSessionMembership(this.pendingByClient.values(), sessionId, droppable)
  }

  private getOrCreateBatch(clientId: string): PendingStreamDataBatch {
    let batch = this.pendingByClient.get(clientId)
    if (!batch) {
      batch = {
        timer: null,
        queue: [],
        queuedChars: 0,
        queuedCharsBySession: new Map(),
        droppableQueuedSessionIds: new Set()
      }
      this.pendingByClient.set(clientId, batch)
    }
    return batch
  }

  queuedCharsForClient(clientId: string): number {
    return this.pendingByClient.get(clientId)?.queuedChars ?? 0
  }

  flush(clientId: string): void {
    flushDaemonStreamData(this.flushArguments(), clientId)
  }

  private refillArmedClients = new Set<string>()

  private flushArguments(): DaemonStreamDataFlushArguments {
    return {
      pendingByClient: this.pendingByClient,
      refillArmedClients: this.refillArmedClients,
      getClient: this.getClient,
      maxLineBytes: this.maxLineBytes,
      onAfterSocketWrite: this.onAfterSocketWrite
    }
  }

  private flushSession(clientId: string, sessionId: string): void {
    const batch = this.pendingByClient.get(clientId)
    if (!batch) {
      return
    }

    const client = this.getClient(clientId)
    const result = flushDaemonStreamSession({
      batch,
      socket: client?.streamSocket && !client.streamSocket.destroyed ? client.streamSocket : null,
      sessionId,
      maxLineBytes: this.maxLineBytes,
      onAfterSocketWrite: this.onAfterSocketWrite,
      writeControl: writeDaemonStreamControl
    })
    if (!result.flushed) {
      return
    }
    if (result.queueEmpty) {
      if (batch.timer) {
        clearTimeout(batch.timer)
        batch.timer = null
      }
      this.pendingByClient.delete(clientId)
    }
  }

  clear(clientId?: string): void {
    const batches =
      clientId === undefined
        ? Array.from(this.pendingByClient.entries())
        : [[clientId, this.pendingByClient.get(clientId)] as const]

    for (const [id, batch] of batches) {
      if (batch?.timer) {
        clearTimeout(batch.timer)
      }
      for (const settle of this.pendingSettlementsByClient.get(id) ?? []) {
        settle(new Error('daemon stream queue was cleared'))
      }
      this.pendingByClient.delete(id)
      this.pendingSettlementsByClient.delete(id)
    }
  }
}
