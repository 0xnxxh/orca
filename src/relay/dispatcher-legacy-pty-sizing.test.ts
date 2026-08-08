import { describe, expect, it, vi } from 'vitest'
import { RelayDispatcher, type SinkWriteSettlement } from './dispatcher'
import { relayWriterControlReserve } from './dispatcher-writer-admission'
import { encodeJsonRpcFrame, type JsonRpcNotification } from './protocol'

function decodeFirstFrame(buf: Buffer): { type: number; id: number; ack: number; payload: Buffer } {
  const type = buf[0]
  const id = buf.readUInt32BE(1)
  const ack = buf.readUInt32BE(5)
  const len = buf.readUInt32BE(9)
  return { type, id, ack, payload: buf.subarray(13, 13 + len) }
}

type DispatcherInternals = {
  primaryClient: object
  estimateFrameBytes: (msg: JsonRpcNotification) => number
  enqueueFrame: (
    client: object,
    msg: JsonRpcNotification,
    lane: string,
    onSettled?: (result: SinkWriteSettlement) => void,
    estimatedBytes?: number
  ) => boolean
}

function referenceMaxChars(
  capacities: number[],
  params: Record<string, unknown>,
  data: string,
  limit: number
): number {
  if (capacities.length === 0) {
    return Math.min(data.length, limit)
  }
  let low = 0
  let high = Math.min(data.length, limit)
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const msg: JsonRpcNotification = {
      jsonrpc: '2.0',
      method: 'pty.data',
      params: { ...params, data: data.slice(0, mid) }
    }
    const bytes = encodeJsonRpcFrame(msg, 0, 0).length
    if (capacities.every((capacity) => bytes <= capacity)) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return low
}

function makeDispatcher(highWaterMarks: number[]): {
  sized: RelayDispatcher
  capacities: number[]
} {
  const [primaryHwm, ...rest] = highWaterMarks
  const sized = new RelayDispatcher(() => true, {
    writableHighWaterMark: () => primaryHwm,
    writableLength: () => 0
  })
  for (const hwm of rest) {
    sized.attachClient(() => true, {
      writableHighWaterMark: () => hwm,
      writableLength: () => 0
    })
  }
  return {
    sized,
    capacities: highWaterMarks.map((hwm) => Math.max(0, hwm - relayWriterControlReserve(hwm)))
  }
}

function mulberry32(seed: number): () => number {
  let value = seed
  return () => {
    value = (value + 0x6d2b79f5) | 0
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

describe('RelayDispatcher legacy PTY chunk sizing', () => {
  const alphabet = 'aZ9 "\\\n\r\t\u001béß€中𝄞😀𐀀�'

  it('matches the pre-optimization sizing loop across randomized inputs', () => {
    const random = mulberry32(0xc0ffee)
    const hwmChoices = [1030, 1100, 1250, 1400, 2048, 1024 * 1024]
    for (let trial = 0; trial < 300; trial++) {
      const length = Math.floor(random() * 240)
      let data = ''
      for (let i = 0; i < length; i++) {
        data += alphabet[Math.floor(random() * alphabet.length)]
      }
      const clientCount = 1 + Math.floor(random() * 2)
      const hwms = Array.from(
        { length: clientCount },
        () => hwmChoices[Math.floor(random() * hwmChoices.length)]
      )
      const params = { id: `pty-${trial}`, seq: trial }
      const { sized, capacities } = makeDispatcher(hwms)
      try {
        for (const limit of [0, 1, Math.floor(length / 2), length, length + 17]) {
          expect(sized.maxLegacyPtyDataChars(params, data, limit)).toBe(
            referenceMaxChars(capacities, params, data, limit)
          )
        }
        expect(sized.maxLegacyPtyDataChars(params, data)).toBe(
          referenceMaxChars(capacities, params, data, data.length)
        )
      } finally {
        sized.dispose()
      }
    }
  })

  it('sizes a chunk that fits every client with a single frame encode', () => {
    const { sized } = makeDispatcher([1024 * 1024])
    try {
      const spy = vi.spyOn(sized as unknown as DispatcherInternals, 'estimateFrameBytes')
      const data = 'x'.repeat(16 * 1024)
      expect(sized.maxLegacyPtyDataChars({ id: 'pty-1' }, data)).toBe(data.length)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      sized.dispose()
    }
  })

  it('publishes PTY data with a single frame estimate', () => {
    const frames: Buffer[] = []
    const publisher = new RelayDispatcher((data) => {
      frames.push(Buffer.from(data))
      return true
    })
    try {
      const spy = vi.spyOn(publisher as unknown as DispatcherInternals, 'estimateFrameBytes')
      expect(publisher.tryNotifyPtyData({ id: 'pty-1', data: 'hello' })).toBe(true)
      expect(frames).toHaveLength(1)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      publisher.dispose()
    }
  })

  it('enqueueFrame with a caller-supplied estimate matches the computed default', () => {
    const frames: Buffer[] = []
    const publisher = new RelayDispatcher((data) => {
      frames.push(Buffer.from(data))
      return true
    })
    try {
      const internals = publisher as unknown as DispatcherInternals
      const msg: JsonRpcNotification = {
        jsonrpc: '2.0',
        method: 'pty.data',
        params: { id: 'pty-1', data: 'héllo "𝄞"\\\n\uD800' }
      }
      expect(internals.enqueueFrame(internals.primaryClient, msg, 'ordinary')).toBe(true)
      expect(
        internals.enqueueFrame(
          internals.primaryClient,
          msg,
          'ordinary',
          undefined,
          internals.estimateFrameBytes(msg)
        )
      ).toBe(true)
      expect(frames).toHaveLength(2)
      expect(decodeFirstFrame(frames[1]).payload.equals(decodeFirstFrame(frames[0]).payload)).toBe(
        true
      )
    } finally {
      publisher.dispose()
    }
  })

  it('enqueueFrame rejects identically with and without a caller-supplied estimate', () => {
    const { sized } = makeDispatcher([1030])
    try {
      const internals = sized as unknown as DispatcherInternals
      const msg: JsonRpcNotification = {
        jsonrpc: '2.0',
        method: 'pty.data',
        params: { id: 'pty-1', data: 'x'.repeat(512) }
      }
      expect(internals.enqueueFrame(internals.primaryClient, msg, 'ordinary')).toBe(false)
      expect(
        internals.enqueueFrame(
          internals.primaryClient,
          msg,
          'ordinary',
          undefined,
          internals.estimateFrameBytes(msg)
        )
      ).toBe(false)
    } finally {
      sized.dispose()
    }
  })
})
