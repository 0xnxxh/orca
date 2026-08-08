import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RelayDispatcher,
  type RelayClientSinkOptions,
  type SinkWriteSettlement
} from './dispatcher'
import {
  TerminalAuthorityEventBuffer,
  TerminalAuthorityEventDelivery
} from './terminal-authority-event-delivery'

type PendingWrite = {
  settle: (result: SinkWriteSettlement) => void
}

class SaturatedSink {
  readonly frames: Record<string, unknown>[] = []
  readonly writes: PendingWrite[] = []
  private readonly drainWaiters: (() => void)[] = []
  private saturated = false

  readonly options: RelayClientSinkOptions = {
    supportsWriteCallback: true,
    writableHighWaterMark: () => 64 * 1024,
    writableLength: () => (this.saturated ? 64 * 1024 : 0),
    waitWriteDrain: (callback) => {
      this.drainWaiters.push(callback)
      return () => {
        const index = this.drainWaiters.indexOf(callback)
        if (index >= 0) {
          this.drainWaiters.splice(index, 1)
        }
      }
    }
  }

  readonly write = (data: Buffer, settle: (result: SinkWriteSettlement) => void): boolean => {
    const length = data.readUInt32BE(9)
    this.frames.push(JSON.parse(data.subarray(13, 13 + length).toString('utf8')))
    this.writes.push({ settle })
    this.saturated = true
    return false
  }

  settleNext(): void {
    this.writes.shift()?.settle({ ok: true })
  }

  drainNext(): void {
    this.saturated = false
    this.drainWaiters[0]?.()
  }
}

describe('terminal authority event delivery', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('keeps a terminal outcome behind queued data on a saturated downstream sink', () => {
    const sink = new SaturatedSink()
    const dispatcher = new RelayDispatcher(sink.write, sink.options)
    const clientId = dispatcher.activeClientIds()[0]
    const failures = vi.fn()
    const delivery = new TerminalAuthorityEventDelivery(
      dispatcher,
      new TerminalAuthorityEventBuffer(),
      () => clientId,
      failures
    )
    try {
      delivery.publish('pty.data', { id: 'pty-1', data: 'first' })
      delivery.publish('pty.data', { id: 'pty-1', data: 'second' })
      delivery.publish('pty.deliveryCanceled', { id: 'pty-1' })

      expect(sink.frames.map((frame) => frame.method)).toEqual(['pty.data'])
      sink.settleNext()
      sink.drainNext()
      expect(sink.frames.map((frame) => frame.method)).toEqual(['pty.data', 'pty.data'])
      sink.settleNext()
      expect(sink.frames.map((frame) => frame.method)).toEqual(['pty.data', 'pty.data'])
      sink.drainNext()

      expect(sink.frames.map((frame) => frame.method)).toEqual([
        'pty.data',
        'pty.data',
        'pty.deliveryCanceled'
      ])
      expect(failures).not.toHaveBeenCalled()
    } finally {
      delivery.clear()
      dispatcher.dispose()
    }
  })
})
