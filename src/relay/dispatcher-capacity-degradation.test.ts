import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { RelayDispatcher, type RelayClientSinkOptions } from './dispatcher'
import { encodeJsonRpcFrame } from './protocol'

type BoundedClient = {
  frames: Buffer[]
  closes: number
  options: RelayClientSinkOptions
  write: (data: Buffer) => boolean
}

// Why: a sink that never accepts a write and never drains retains producer bytes, so the queue saturates
// while every individual frame stays comfortably inside the per-frame capacity.
function makeSaturatingClient(highWaterMark: number): BoundedClient {
  const client = makeBoundedClient(highWaterMark)
  client.write = (data: Buffer) => {
    client.frames.push(Buffer.from(data))
    return false
  }
  return client
}

function makeBoundedClient(highWaterMark: number): BoundedClient {
  const client: BoundedClient = {
    frames: [],
    closes: 0,
    write: (data: Buffer) => {
      client.frames.push(Buffer.from(data))
      return true
    },
    options: {
      writableHighWaterMark: () => highWaterMark,
      writableLength: () => 0,
      close: () => {
        client.closes++
      }
    }
  }
  return client
}

function decodePayload(frame: Buffer): Record<string, unknown> {
  const length = frame.readUInt32BE(9)
  return JSON.parse(frame.subarray(13, 13 + length).toString('utf-8'))
}

describe('RelayDispatcher bounded-capacity degradation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('producerEnvelopeBudget returns a negative budget for an over-cap envelope', () => {
    const primary = makeBoundedClient(16384)
    const bounded = new RelayDispatcher(primary.write, primary.options)
    try {
      expect(
        bounded.producerEnvelopeBudget('fs.changed', { events: ['x'.repeat(64)] })
      ).toBeGreaterThan(0)
      expect(
        bounded.producerEnvelopeBudget('fs.changed', { events: ['x'.repeat(20_000)] })
      ).toBeLessThan(0)
    } finally {
      bounded.dispose()
    }
  })

  it('producerEnvelopeBudget takes the smallest client capacity unless a client is named', () => {
    const primary = makeBoundedClient(65536)
    const secondary = makeBoundedClient(16384)
    const bounded = new RelayDispatcher(primary.write, primary.options)
    try {
      const secondaryId = bounded.attachClient(secondary.write, secondary.options)
      const params = { events: ['x'.repeat(64)] }
      const envelopeBytes = encodeJsonRpcFrame(
        { jsonrpc: '2.0', method: 'fs.changed', params },
        0,
        0
      ).length

      expect(bounded.activeClientIds()).toHaveLength(2)
      expect(bounded.producerEnvelopeBudget('fs.changed', params)).toBe(12288 - envelopeBytes)
      expect(
        bounded.producerEnvelopeBudget('fs.changed', params, bounded.activeClientIds()[0])
      ).toBe(49152 - envelopeBytes)
      expect(bounded.producerEnvelopeBudget('fs.changed', params, secondaryId)).toBe(
        12288 - envelopeBytes
      )
      expect(bounded.producerEnvelopeBudget('fs.changed', params, 999)).toBe(
        Number.MAX_SAFE_INTEGER
      )
    } finally {
      bounded.dispose()
    }
  })

  it('producerDataBudget keeps its pre-delegation value for a pty.data envelope', () => {
    const primary = makeBoundedClient(65536)
    const bounded = new RelayDispatcher(primary.write, primary.options)
    try {
      // Snapshot of the shipped formula: 49152-byte producer capacity minus the 96-byte empty-data frame.
      expect(bounded.producerDataBudget('pty.data', { ptyId: 'pty-7', seq: 42 })).toBe(49056)
      expect(bounded.producerDataBudget('pty.data', { ptyId: 'pty-7', seq: 42 }, 999)).toBe(
        Number.MAX_SAFE_INTEGER
      )
    } finally {
      bounded.dispose()
    }
  })

  it('producerDataBudget floors at zero when the envelope alone exceeds capacity', () => {
    const primary = makeBoundedClient(1030)
    const bounded = new RelayDispatcher(primary.write, primary.options)
    try {
      expect(bounded.producerDataBudget('pty.data', { ptyId: 'x'.repeat(4096) })).toBe(0)
    } finally {
      bounded.dispose()
    }
  })

  it('notify drops an over-capacity frame and keeps the client open', () => {
    const primary = makeBoundedClient(16384)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const bounded = new RelayDispatcher(primary.write, primary.options)
    try {
      bounded.notify('fs.changed', { events: ['x'.repeat(20_000)] })

      expect(primary.closes).toBe(0)
      expect(primary.frames).toHaveLength(0)
      expect(stderr).toHaveBeenCalledTimes(1)
      expect(stderr.mock.calls[0][0]).toMatch(
        /^\[relay\] Dropped fs\.changed \(\d+B > producer frame capacity 12288B\)\n$/
      )

      bounded.notify('pty.exit', { id: 'pty-1' })
      expect(primary.frames).toHaveLength(1)
      expect(decodePayload(primary.frames[0]).method).toBe('pty.exit')
    } finally {
      stderr.mockRestore()
      bounded.dispose()
    }
  })

  it('logs at most one drop per client generation', () => {
    const primary = makeBoundedClient(16384)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const bounded = new RelayDispatcher(primary.write, primary.options)
    try {
      const flood = { events: ['x'.repeat(20_000)] }
      bounded.notify('fs.changed', flood)
      bounded.notify('fs.changed', flood)
      expect(stderr).toHaveBeenCalledTimes(1)

      const reattached = makeBoundedClient(16384)
      bounded.setWrite(reattached.write, reattached.options)
      bounded.notify('fs.changed', flood)
      expect(stderr).toHaveBeenCalledTimes(2)
    } finally {
      stderr.mockRestore()
      bounded.dispose()
    }
  })

  it('distinguishes an over-capacity drop from a producer-queue-full drop on one client', () => {
    const primary = makeSaturatingClient(4 * 1024 * 1024)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const bounded = new RelayDispatcher(primary.write, primary.options)
    try {
      // The first 1.5MB frame is retained by the stalled sink; the second exceeds the 2MB producer queue.
      bounded.notify('fs.changed', { events: ['x'.repeat(1_500_000)] })
      expect(primary.frames).toHaveLength(1)
      bounded.notify('fs.changed', { events: ['x'.repeat(1_500_000)] })
      bounded.notify('fs.changed', { events: ['x'.repeat(5_000_000)] })

      expect(primary.closes).toBe(0)
      expect(stderr).toHaveBeenCalledTimes(2)
      expect(stderr.mock.calls[0][0]).toMatch(
        /^\[relay\] Dropped fs\.changed \(\d+B, producer queue full; frame capacity 4128768B\)\n$/
      )
      expect(stderr.mock.calls[1][0]).toMatch(
        /^\[relay\] Dropped fs\.changed \(\d+B > producer frame capacity 4128768B\)\n$/
      )

      // Both classifications stay one-per-generation once logged.
      bounded.notify('fs.changed', { events: ['x'.repeat(1_500_000)] })
      bounded.notify('fs.changed', { events: ['x'.repeat(5_000_000)] })
      expect(stderr).toHaveBeenCalledTimes(2)
    } finally {
      stderr.mockRestore()
      bounded.dispose()
    }
  })

  it('logs each dropped method once instead of letting the first method silence the rest', () => {
    const primary = makeBoundedClient(16384)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const bounded = new RelayDispatcher(primary.write, primary.options)
    try {
      const flood = { events: ['x'.repeat(20_000)] }
      bounded.notify('fs.changed', flood)
      bounded.notify('pty.data', flood)
      bounded.notify('fs.changed', flood)
      bounded.notify('pty.data', flood)

      expect(stderr).toHaveBeenCalledTimes(2)
      expect(stderr.mock.calls[0][0]).toContain('Dropped fs.changed')
      expect(stderr.mock.calls[1][0]).toContain('Dropped pty.data')
    } finally {
      stderr.mockRestore()
      bounded.dispose()
    }
  })

  it('publishProducerNotification publishes on the producer lane and never closes', () => {
    const primary = makeBoundedClient(65536)
    const secondary = makeBoundedClient(16384)
    const bounded = new RelayDispatcher(primary.write, primary.options)
    try {
      const secondaryId = bounded.attachClient(secondary.write, secondary.options)

      expect(bounded.publishProducerNotification(secondaryId, 'fs.changed', { events: [] })).toBe(
        true
      )
      expect(secondary.frames).toHaveLength(1)
      expect(primary.frames).toHaveLength(0)

      expect(
        bounded.publishProducerNotification(secondaryId, 'fs.changed', {
          events: ['x'.repeat(20_000)]
        })
      ).toBe(false)
      expect(secondary.closes).toBe(0)
      expect(secondary.frames).toHaveLength(1)

      expect(bounded.publishProducerNotification(999, 'fs.changed')).toBe(false)
    } finally {
      bounded.dispose()
    }
  })

  it('sendResponse substitutes a JSON-RPC error instead of closing when the legacy lane rejects', async () => {
    const primary = makeBoundedClient(65536)
    const bounded = new RelayDispatcher(primary.write, primary.options)
    try {
      bounded.onRequest('fs.listFiles', async () => ({ paths: 'x'.repeat(3 * 1024 * 1024) }))
      bounded.feed(encodeJsonRpcFrame({ jsonrpc: '2.0', id: 77, method: 'fs.listFiles' }, 1, 0))
      await vi.advanceTimersByTimeAsync(0)

      expect(primary.closes).toBe(0)
      expect(primary.frames).toHaveLength(1)
      const response = decodePayload(primary.frames[0]) as unknown as {
        id: number
        error: { code: number; message: string }
      }
      expect(response.id).toBe(77)
      expect(response.error.code).toBe(-32010)
      expect(response.error.message).toBe('Relay response exceeded the bounded transport capacity')
    } finally {
      bounded.dispose()
    }
  })

  it('sendResponse leaves an already-failed response rejected without closing', async () => {
    const primary = makeBoundedClient(65536)
    const bounded = new RelayDispatcher(primary.write, primary.options)
    try {
      bounded.onRequest('fs.listFiles', async () => {
        throw new Error('x'.repeat(3 * 1024 * 1024))
      })
      bounded.feed(encodeJsonRpcFrame({ jsonrpc: '2.0', id: 78, method: 'fs.listFiles' }, 1, 0))
      await vi.advanceTimersByTimeAsync(0)

      expect(primary.closes).toBe(0)
      expect(primary.frames).toHaveLength(0)
    } finally {
      bounded.dispose()
    }
  })
})
