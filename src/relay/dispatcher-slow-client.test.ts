import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelayDispatcher, type RelayClientSinkOptions } from './dispatcher'
import { PROJECTION_STALL_EVICTION_MS } from './dispatcher-projection-stall'
import { DISPATCHER_CONTROL_QUEUE_MAX_FRAMES } from './dispatcher-writer-admission'

type SlowClient = {
  frames: Buffer[]
  closes: number
  options: RelayClientSinkOptions
  write: (data: Buffer) => boolean
  drain: () => void
}

// Why: a sink that refuses every write until told otherwise reproduces the ~268ms link in #12041, where
// full-screen redraws outrun the client's drain rate and saturate the bounded producer lane.
function makeStallingClient(highWaterMark: number, drainable = false): SlowClient {
  let stalled = true
  let drainWaiter: (() => void) | null = null
  const client: SlowClient = {
    frames: [],
    closes: 0,
    write: (data: Buffer) => {
      client.frames.push(Buffer.from(data))
      return !stalled
    },
    options: {
      writableHighWaterMark: () => highWaterMark,
      writableLength: () => 0,
      close: () => {
        client.closes++
      },
      ...(drainable
        ? {
            waitWriteDrain: (callback: () => void) => {
              drainWaiter = callback
            }
          }
        : {})
    },
    drain: () => {
      stalled = false
      const waiter = drainWaiter
      drainWaiter = null
      waiter?.()
    }
  }
  return client
}

function ptyDataFrameCount(frames: Buffer[]): number {
  return frames.filter((frame) => {
    const length = frame.readUInt32BE(9)
    const message = JSON.parse(frame.subarray(13, 13 + length).toString('utf-8')) as {
      method?: string
    }
    return message.method === 'pty.data'
  }).length
}

// Fills the 2 MiB producer lane to the byte, so even a bare pty.exit no longer fits.
function fillProducerQueue(dispatcher: RelayDispatcher, clientId: number): void {
  for (const size of [40_000, 32]) {
    while (
      dispatcher.tryNotifyPtyDataToClient(
        clientId,
        { id: 'pty-1', data: 'x'.repeat(size) },
        () => {}
      )
    ) {
      /* saturate */
    }
  }
}

describe('RelayDispatcher slow-client PTY projection', () => {
  it('tryNotifyPtyData applies backpressure without closing the client', () => {
    const primary = makeStallingClient(65536)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    try {
      let accepted = 0
      let rejected = 0
      for (let index = 0; index < 200; index++) {
        if (dispatcher.tryNotifyPtyData({ id: 'pty-1', data: 'x'.repeat(40_000) })) {
          accepted++
        } else {
          rejected++
        }
      }
      expect(accepted).toBeGreaterThan(0)
      expect(rejected).toBeGreaterThan(0)
      expect(primary.closes).toBe(0)
    } finally {
      dispatcher.dispose()
    }
  })

  it('rejects a projected pty.data frame instead of closing a subscriber that cannot drain', () => {
    const primary = makeStallingClient(65536)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      fillProducerQueue(dispatcher, dispatcher.activeClientIds()[0])

      const projected = dispatcher.projectPtyDataToMatchingClients(() => true, {
        id: 'pty-1',
        data: 'y'.repeat(40_000)
      })

      // A false return is what makes pty-handler pause the PTY and republish the span after drain.
      expect(projected).toBe(false)
      expect(primary.closes).toBe(0)
    } finally {
      stderr.mockRestore()
      dispatcher.dispose()
    }
  })

  it('sheds a projected frame no sink can ever admit rather than wedging the PTY', () => {
    const primary = makeStallingClient(65536)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      // Larger than producerFrameCapacity (49152B), so retrying it forever would stall the PTY.
      const projected = dispatcher.projectPtyDataToMatchingClients(() => true, {
        id: 'pty-1',
        data: 'y'.repeat(60_000)
      })

      expect(projected).toBe(true)
      expect(primary.closes).toBe(0)
      const drops = stderr.mock.calls.filter((call) =>
        /producer frame capacity/.test(String(call[0]))
      )
      expect(drops).toHaveLength(1)
      expect(String(drops[0][0])).toMatch(
        /^\[relay\] Dropped pty\.data \(\d+B > producer frame capacity 49152B\)\n$/
      )
    } finally {
      stderr.mockRestore()
      dispatcher.dispose()
    }
  })

  it('delivers a rejected projection exactly once to every subscriber after the stalled sink drains', () => {
    const stalled = makeStallingClient(65536, true)
    const healthy = makeStallingClient(65536, true)
    healthy.drain()
    const dispatcher = new RelayDispatcher(stalled.write, stalled.options)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      dispatcher.attachClient(healthy.write, healthy.options)
      fillProducerQueue(dispatcher, dispatcher.activeClientIds()[0])
      const healthyBefore = ptyDataFrameCount(healthy.frames)

      const params = { id: 'pty-1', data: 'y'.repeat(40_000) }
      expect(dispatcher.projectPtyDataToMatchingClients(() => true, params)).toBe(false)
      // All-or-nothing: the healthy subscriber must not get a copy the retry would duplicate.
      expect(ptyDataFrameCount(healthy.frames)).toBe(healthyBefore)

      stalled.drain()
      expect(dispatcher.projectPtyDataToMatchingClients(() => true, params)).toBe(true)
      expect(ptyDataFrameCount(healthy.frames)).toBe(healthyBefore + 1)
      expect(stalled.closes).toBe(0)
      expect(healthy.closes).toBe(0)
    } finally {
      stderr.mockRestore()
      dispatcher.dispose()
    }
  })

  it('holds a projected pty.exit for retry instead of closing a saturated subscriber', () => {
    const primary = makeStallingClient(65536, true)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      fillProducerQueue(dispatcher, dispatcher.activeClientIds()[0])

      const params = { id: 'pty-1', exitCode: 0 }
      expect(dispatcher.projectPtyExitToMatchingClients(() => true, params)).toBe(false)
      expect(primary.closes).toBe(0)

      primary.drain()
      expect(dispatcher.projectPtyExitToMatchingClients(() => true, params)).toBe(true)
    } finally {
      stderr.mockRestore()
      dispatcher.dispose()
    }
  })

  it('never encodes a projection with no subscribers', () => {
    const primary = makeStallingClient(65536)
    primary.drain()
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    try {
      // A flow-controlled owner is excluded from the legacy projection, so "no target" is the hot path.
      let reads = 0
      const params = {
        id: 'pty-1',
        get data(): string {
          reads++
          return 'y'.repeat(40_000)
        }
      }

      expect(dispatcher.projectPtyDataToMatchingClients(() => false, params)).toBe(true)
      expect(reads).toBe(0)

      expect(dispatcher.projectPtyDataToMatchingClients(() => true, params)).toBe(true)
      expect(reads).toBeGreaterThan(0)
    } finally {
      dispatcher.dispose()
    }
  })

  it('a >1MiB response while the producer queue is full does not close the client', async () => {
    const primary = makeStallingClient(65536)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      dispatcher.onRequest('pty.serialize', async () => ({ data: 'z'.repeat(1_500_000) }))
      fillProducerQueue(dispatcher, dispatcher.activeClientIds()[0])

      await new Promise<void>((resolve) => setTimeout(resolve, 50))
      expect(primary.closes).toBe(0)
    } finally {
      stderr.mockRestore()
      dispatcher.dispose()
    }
  })
})

describe('RelayDispatcher stalled-subscriber eviction', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('detaches a subscriber that never drains so the paused PTY can resume', () => {
    vi.useFakeTimers()
    const primary = makeStallingClient(65536)
    primary.drain()
    const stalled = makeStallingClient(65536)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      const stalledId = dispatcher.attachClient(stalled.write, stalled.options)
      fillProducerQueue(dispatcher, stalledId)
      let capacityNotifications = 0
      dispatcher.onLegacyPtyCapacity(() => {
        capacityNotifications++
      })

      const params = { id: 'pty-1', data: 'y'.repeat(40_000) }
      expect(dispatcher.projectPtyDataToMatchingClients(() => true, params)).toBe(false)
      expect(stalled.closes).toBe(0)

      vi.advanceTimersByTime(PROJECTION_STALL_EVICTION_MS + 1)

      expect(stalled.closes).toBe(1)
      // The eviction is only worth anything if it un-wedges the producer it was blocking.
      expect(capacityNotifications).toBeGreaterThan(0)
      expect(dispatcher.projectPtyDataToMatchingClients(() => true, params)).toBe(true)
      expect(primary.closes).toBe(0)
    } finally {
      stderr.mockRestore()
      dispatcher.dispose()
    }
  })

  it('never evicts the primary link, however long it back-pressures', () => {
    vi.useFakeTimers()
    const primary = makeStallingClient(65536)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      fillProducerQueue(dispatcher, dispatcher.activeClientIds()[0])

      const params = { id: 'pty-1', data: 'y'.repeat(40_000) }
      expect(dispatcher.projectPtyDataToMatchingClients(() => true, params)).toBe(false)

      vi.advanceTimersByTime(PROJECTION_STALL_EVICTION_MS * 10)

      expect(primary.closes).toBe(0)
      expect(dispatcher.activeClientIds()).toHaveLength(1)
    } finally {
      stderr.mockRestore()
      dispatcher.dispose()
    }
  })

  it('spares a subscriber that drains inside the stall window', () => {
    vi.useFakeTimers()
    const primary = makeStallingClient(65536)
    primary.drain()
    const slow = makeStallingClient(65536, true)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      const slowId = dispatcher.attachClient(slow.write, slow.options)
      fillProducerQueue(dispatcher, slowId)

      const params = { id: 'pty-1', data: 'y'.repeat(40_000) }
      expect(dispatcher.projectPtyDataToMatchingClients(() => true, params)).toBe(false)

      vi.advanceTimersByTime(PROJECTION_STALL_EVICTION_MS - 1)
      slow.drain()
      vi.advanceTimersByTime(PROJECTION_STALL_EVICTION_MS * 4)

      expect(slow.closes).toBe(0)
      expect(dispatcher.projectPtyDataToMatchingClients(() => true, params)).toBe(true)
    } finally {
      stderr.mockRestore()
      dispatcher.dispose()
    }
  })
})

describe('RelayDispatcher pty.replay under a full control lane', () => {
  it('drops replay instead of killing a link that would regenerate the same replay', () => {
    const primary = makeStallingClient(65536)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      // REPLAY_BUFFER_MAX is 100 KiB per PTY; a restored workspace replays many terminals at once.
      for (let index = 0; index < 12; index++) {
        dispatcher.notify('pty.replay', { id: `pty-${index}`, data: 'x'.repeat(100 * 1024) })
      }
      expect(primary.closes).toBe(0)
    } finally {
      stderr.mockRestore()
      dispatcher.dispose()
    }
  })

  it('logs one dropped-replay line per generation however many panes are stranded', () => {
    const primary = makeStallingClient(65536)
    const dispatcher = new RelayDispatcher(primary.write, primary.options)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      const clientId = dispatcher.activeClientIds()[0]
      for (let index = 0; index < DISPATCHER_CONTROL_QUEUE_MAX_FRAMES; index += 1) {
        dispatcher.notifyClient(clientId, `control.${index}`)
      }
      stderr.mockClear()

      dispatcher.notify('pty.replay', { id: 'pty-1', data: 'x' })
      expect(primary.closes).toBe(0)
      expect(stderr).toHaveBeenCalledTimes(1)
      expect(String(stderr.mock.calls[0][0])).toMatch(/^\[relay\] Dropped pty\.replay \(/)

      dispatcher.notify('pty.replay', { id: 'pty-2', data: 'x' })
      expect(primary.closes).toBe(0)
      expect(stderr).toHaveBeenCalledTimes(1)
    } finally {
      stderr.mockRestore()
      dispatcher.dispose()
    }
  })
})
