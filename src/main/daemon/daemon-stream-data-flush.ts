import type { Socket } from 'node:net'
import { encodeNdjson } from './ndjson'
import { recordDaemonStreamBacklogEvent } from './daemon-stream-backlog-probe'
import {
  clampToSafeSplitIndex,
  encodeStreamDataEvent,
  writeStreamDataEvents
} from './daemon-stream-data-split'
import type { PendingStreamDataBatch } from './daemon-stream-keep-tail-drop'

const SHALLOW_SOCKET_WRITE_GATE_BYTES =
  process.env.ORCA_DAEMON_SHALLOW_SOCKET_GATE === '0' ? Number.POSITIVE_INFINITY : 128 * 1024
const BULK_WRITE_SLICE_CHARS = 64 * 1024
const HELD_WRITE_THROUGH_TOTAL_CHARS = 32 * 1024 * 1024
const SMALL_SESSION_HOLD_BYPASS_CHARS = 4 * 1024

export type DaemonStreamDataFlushArguments = {
  pendingByClient: Map<string, PendingStreamDataBatch>
  refillArmedClients: Set<string>
  getClient: (clientId: string) => { streamSocket: Socket | null } | undefined
  maxLineBytes: number
  onAfterSocketWrite: (() => void) | undefined
}

export function flushDaemonStreamData(
  args: DaemonStreamDataFlushArguments,
  clientId: string
): void {
  const batch = args.pendingByClient.get(clientId)
  if (!batch) {
    return
  }

  if (batch.timer) {
    clearTimeout(batch.timer)
    batch.timer = null
  }

  const client = args.getClient(clientId)
  if (!client?.streamSocket || client.streamSocket.destroyed) {
    args.pendingByClient.delete(clientId)
    return
  }

  const socket = client.streamSocket
  const heldSessions = new Set<string>()
  const retained: PendingStreamDataBatch['queue'] = []
  while (batch.queue.length > 0) {
    const entry = batch.queue[0]
    if (entry.control) {
      if (heldSessions.has(entry.sessionId)) {
        retained.push(entry)
        batch.queue.shift()
        continue
      }
      batch.queue.shift()
      writeDaemonStreamControl(socket, entry)
      args.onAfterSocketWrite?.()
      continue
    }
    const socketDeep = (socket.writableLength ?? 0) >= SHALLOW_SOCKET_WRITE_GATE_BYTES
    if (socketDeep && batch.queuedChars <= HELD_WRITE_THROUGH_TOTAL_CHARS) {
      const sessionHeld = batch.queuedCharsBySession.get(entry.sessionId) ?? 0
      if (heldSessions.has(entry.sessionId) || sessionHeld > SMALL_SESSION_HOLD_BYPASS_CHARS) {
        heldSessions.add(entry.sessionId)
        retained.push(entry)
        batch.queue.shift()
        continue
      }
    } else if (socketDeep) {
      recordDaemonStreamBacklogEvent('heldWriteThrough', {
        heldChars: batch.queuedChars,
        socketBufferedBytes: socket.writableLength ?? 0
      })
    }
    const end =
      entry.transformed || entry.data.length <= BULK_WRITE_SLICE_CHARS
        ? entry.data.length
        : clampToSafeSplitIndex(entry.data, 0, BULK_WRITE_SLICE_CHARS)
    const slice = entry.data.slice(0, end)
    const entrySequenceChars = entry.sequenceChars ?? entry.data.length
    const sliceSequenceChars = entry.transformed
      ? entrySequenceChars
      : entrySequenceChars === 0
        ? 0
        : slice.length
    if (end >= entry.data.length) {
      batch.queue.shift()
    } else {
      entry.data = entry.data.slice(end)
      const remainingSequenceChars = entrySequenceChars - sliceSequenceChars
      entry.sequenceChars =
        remainingSequenceChars === entry.data.length ? undefined : remainingSequenceChars
    }
    batch.queuedChars -= slice.length
    const sessionHeldAfter =
      (batch.queuedCharsBySession.get(entry.sessionId) ?? slice.length) - slice.length
    if (sessionHeldAfter <= 0) {
      batch.queuedCharsBySession.delete(entry.sessionId)
      batch.droppableQueuedSessionIds.delete(entry.sessionId)
    } else {
      batch.queuedCharsBySession.set(entry.sessionId, sessionHeldAfter)
    }
    writeStreamDataEvents(
      socket,
      entry.sessionId,
      slice,
      args.maxLineBytes,
      sliceSequenceChars,
      entry.seq,
      entry.transformed
    )
    args.onAfterSocketWrite?.()
  }
  if (retained.length > 0) {
    batch.queue = retained
    armHeldDaemonStreamQueue(args, socket, clientId, retained[0].sessionId)
    return
  }
  args.pendingByClient.delete(clientId)
}

function armHeldDaemonStreamQueue(
  args: DaemonStreamDataFlushArguments,
  socket: Socket,
  clientId: string,
  sessionId: string
): void {
  if (args.refillArmedClients.has(clientId) || socket.destroyed) {
    return
  }
  args.refillArmedClients.add(clientId)
  socket.write(encodeStreamDataEvent(sessionId, ''), () => {
    args.refillArmedClients.delete(clientId)
    flushDaemonStreamData(args, clientId)
  })
}

export function writeDaemonStreamControl(
  socket: Socket,
  entry: PendingStreamDataBatch['queue'][number]
): void {
  try {
    socket.write(encodeNdjson(entry.control!), (error?: Error | null) => {
      entry.settle?.(error ?? null)
    })
  } catch (error) {
    entry.settle?.(error instanceof Error ? error : new Error(String(error)))
  }
}
