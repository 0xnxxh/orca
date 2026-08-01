import { describe, expect, it } from 'vitest'
import { RelayDispatcher } from './dispatcher'
import type { RelayClientSinkOptions, RelayClientWrite } from './dispatcher-writer-sink'
import { HEADER_LENGTH, parseJsonRpcMessage } from './protocol'
import { emitRelayWatcherEvents, emitRelayWatcherOverflow } from './relay-watcher-event-emitter'

type WatcherFrameEvent = { kind: string; absolutePath: string; isDirectory?: boolean }

function frameMessage(frame: Buffer): { method: string; params?: Record<string, unknown> } {
  const payloadLength = frame.readUInt32BE(9)
  const message = parseJsonRpcMessage(frame.subarray(HEADER_LENGTH, HEADER_LENGTH + payloadLength))
  return 'method' in message
    ? { method: message.method, params: message.params as Record<string, unknown> | undefined }
    : { method: '' }
}

function frameMethod(frame: Buffer): string {
  return frameMessage(frame).method
}

function frameEvents(frame: Buffer): WatcherFrameEvent[] {
  const params = frameMessage(frame).params
  return (params?.events ?? []) as WatcherFrameEvent[]
}

function createRecordingSink(highWaterMark?: number): {
  frames: Buffer[]
  closes: () => number
  drainWaiters: (() => void)[]
  blockNextWrite: () => void
  write: RelayClientWrite
  options: RelayClientSinkOptions
} {
  const frames: Buffer[] = []
  const drainWaiters: (() => void)[] = []
  let closes = 0
  let blocked = false
  const write: RelayClientWrite = (frame) => {
    frames.push(Buffer.from(frame))
    if (blocked) {
      blocked = false
      return false
    }
    return true
  }
  const options: RelayClientSinkOptions = {
    ...(highWaterMark === undefined ? {} : { writableHighWaterMark: () => highWaterMark }),
    close: () => {
      closes += 1
    },
    waitWriteDrain: (callback) => {
      drainWaiters.push(callback)
      return () => {
        const index = drainWaiters.indexOf(callback)
        if (index >= 0) {
          drainWaiters.splice(index, 1)
        }
      }
    }
  }
  return {
    frames,
    closes: () => closes,
    drainWaiters,
    blockNextWrite: () => {
      blocked = true
    },
    write,
    options
  }
}

function watcherBatch(count: number): { type: 'create'; path: string; isDirectory: false }[] {
  return Array.from({ length: count }, (_unused, index) => ({
    type: 'create' as const,
    path: `/workspace/project/src/module-${index}/component-${index}.tsx`,
    isDirectory: false as const
  }))
}

describe('relay watcher writer admission', () => {
  it('keeps watcher batches on the producer lane while overflow markers ride the control lane', () => {
    const sink = createRecordingSink()
    sink.blockNextWrite()
    const dispatcher = new RelayDispatcher(sink.write, sink.options)

    try {
      emitRelayWatcherEvents(dispatcher, '/workspace', false, [
        { type: 'create', path: '/workspace/first', isDirectory: false }
      ])
      emitRelayWatcherOverflow(dispatcher, '/workspace', false)
      dispatcher.notifyClient(1, 'control.event')

      expect(sink.frames.map(frameMethod)).toEqual(['fs.changed'])
      sink.drainWaiters.shift()?.()
      // The marker now shares the control lane with control.event and drains ahead of the producer lanes.
      expect(sink.frames.map(frameMethod)).toEqual(['fs.changed', 'fs.changed', 'control.event'])
      expect(frameEvents(sink.frames[1])).toEqual([
        { kind: 'overflow', absolutePath: '/workspace' }
      ])
    } finally {
      dispatcher.dispose()
    }
  })
})

describe('relay watcher batch chunking', () => {
  it.each([
    [65536, 49152],
    [16384, 12288]
  ])('splits a 5000-event batch into frames that fit a %i-byte sink', (highWaterMark, capacity) => {
    const sink = createRecordingSink(highWaterMark)
    const dispatcher = new RelayDispatcher(sink.write, sink.options)
    const events = watcherBatch(5000)

    try {
      emitRelayWatcherEvents(dispatcher, '/workspace', false, events)

      expect(sink.frames.length).toBeGreaterThan(1)
      expect(sink.frames.every((frame) => frameMethod(frame) === 'fs.changed')).toBe(true)
      expect(sink.frames.every((frame) => frame.length <= capacity)).toBe(true)
      expect(sink.frames.flatMap(frameEvents)).toEqual(
        events.map((event) => ({
          kind: event.type,
          absolutePath: event.path,
          isDirectory: event.isDirectory
        }))
      )
      expect(sink.closes()).toBe(0)
    } finally {
      dispatcher.dispose()
    }
  })

  it('falls back to one overflow marker when a single event exceeds the frame budget', () => {
    const sink = createRecordingSink(65536)
    const dispatcher = new RelayDispatcher(sink.write, sink.options)

    try {
      emitRelayWatcherEvents(dispatcher, '/workspace', false, [
        { type: 'update', path: `/workspace/${'p'.repeat(60_000)}`, isDirectory: false }
      ])

      expect(sink.frames.map(frameMethod)).toEqual(['fs.changed'])
      expect(frameEvents(sink.frames[0])).toEqual([
        { kind: 'overflow', absolutePath: '/workspace' }
      ])
      expect(sink.closes()).toBe(0)
    } finally {
      dispatcher.dispose()
    }
  })

  it('emits the overflow marker on the control lane when a chunk is rejected by a full producer queue', () => {
    const sink = createRecordingSink(65536)
    sink.blockNextWrite()
    const dispatcher = new RelayDispatcher(sink.write, sink.options)

    try {
      // Fill the 2 MB producer queue down to a residue smaller than a one-event fs.changed frame.
      let admitted = 0
      for (const chunk of [40_000, 1_000, 1]) {
        while (
          admitted < 5_000 &&
          dispatcher.tryNotifyPtyData({ paneId: 'pane', data: 'x'.repeat(chunk) })
        ) {
          admitted += 1
        }
      }
      expect(admitted).toBeGreaterThan(0)
      expect(admitted).toBeLessThan(5_000)

      emitRelayWatcherEvents(dispatcher, '/workspace', false, [
        { type: 'create', path: '/workspace/first', isDirectory: false }
      ])
      sink.drainWaiters.shift()?.()

      const markers = sink.frames.filter((frame) => frameMethod(frame) === 'fs.changed')
      expect(markers).toHaveLength(1)
      expect(frameEvents(markers[0])).toEqual([{ kind: 'overflow', absolutePath: '/workspace' }])
      // Control lane preempts: the marker lands before the producer frames still queued behind it.
      expect(sink.frames.indexOf(markers[0])).toBeLessThan(sink.frames.length - 1)
      expect(sink.closes()).toBe(0)
    } finally {
      dispatcher.dispose()
    }
  })

  it('chunks per client so a small sink never degrades a healthy one', () => {
    const healthy = createRecordingSink(65536)
    const small = createRecordingSink(16384)
    const dispatcher = new RelayDispatcher(healthy.write, healthy.options)

    try {
      dispatcher.attachClient(small.write, small.options)
      const events = watcherBatch(200)
      emitRelayWatcherEvents(dispatcher, '/workspace', false, events)

      const expected = events.map((event) => ({
        kind: event.type,
        absolutePath: event.path,
        isDirectory: event.isDirectory
      }))
      expect(healthy.frames).toHaveLength(1)
      expect(frameEvents(healthy.frames[0])).toEqual(expected)
      expect(small.frames.length).toBeGreaterThan(1)
      expect(small.frames.every((frame) => frame.length <= 12288)).toBe(true)
      expect(small.frames.flatMap(frameEvents)).toEqual(expected)
      expect(healthy.closes()).toBe(0)
      expect(small.closes()).toBe(0)
    } finally {
      dispatcher.dispose()
    }
  })
})
