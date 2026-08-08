import type { Socket } from 'node:net'
import { writeStreamDataEvents } from './daemon-stream-data-split'
import type { PendingStreamDataBatch } from './daemon-stream-keep-tail-drop'

export function flushDaemonStreamSession(args: {
  batch: PendingStreamDataBatch
  socket: Socket | null
  sessionId: string
  maxLineBytes: number
  onAfterSocketWrite?: () => void
  writeControl: (socket: Socket, entry: PendingStreamDataBatch['queue'][number]) => void
}): { flushed: boolean; queueEmpty: boolean } {
  const flushed: PendingStreamDataBatch['queue'] = []
  const retained: PendingStreamDataBatch['queue'] = []
  let flushedChars = 0
  for (const entry of args.batch.queue) {
    if (entry.sessionId === args.sessionId) {
      flushed.push(entry)
      flushedChars += entry.data.length
    } else {
      retained.push(entry)
    }
  }
  if (flushed.length === 0) {
    return { flushed: false, queueEmpty: false }
  }

  args.batch.queue = retained
  args.batch.queuedChars -= flushedChars
  args.batch.queuedCharsBySession.delete(args.sessionId)
  args.batch.droppableQueuedSessionIds.delete(args.sessionId)
  for (const entry of flushed) {
    if (args.socket) {
      if (entry.control) {
        args.writeControl(args.socket, entry)
      } else {
        writeStreamDataEvents(
          args.socket,
          entry.sessionId,
          entry.data,
          args.maxLineBytes,
          entry.sequenceChars ?? entry.data.length,
          entry.seq,
          entry.transformed
        )
      }
      args.onAfterSocketWrite?.()
    }
  }
  return { flushed: true, queueEmpty: args.batch.queue.length === 0 }
}
