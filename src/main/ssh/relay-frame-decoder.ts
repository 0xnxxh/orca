export const HEADER_LENGTH = 13
export const MAX_MESSAGE_SIZE = 16 * 1024 * 1024
export const FRAME_DECODER_MAX_FRAMES_PER_TURN = 64
export const FRAME_DECODER_MAX_BYTES_PER_TURN = MAX_MESSAGE_SIZE + HEADER_LENGTH
export const FRAME_DECODER_MAX_TURN_MS = 4,
  FRAME_DECODER_MAX_RETAINED_BYTES = 2 * (MAX_MESSAGE_SIZE + HEADER_LENGTH)

export type DecodedFrame = {
  type: number
  id: number
  ack: number
  payload: Buffer
}

export type FrameDecoderOptions = {
  maxFramesPerTurn?: number
  maxBytesPerTurn?: number
  maxTurnMs?: number
  now?: () => number
  schedule?: (callback: () => void) => unknown
  cancelScheduled?: (handle: unknown) => void
  pause?: () => void
  resume?: () => void
}

export class FrameDecoder {
  private chunks: Buffer[] = []
  private bufferedLength = 0
  private oversizedPayloadBytesRemaining = 0
  private onFrame: (frame: DecodedFrame) => void
  private onError: ((err: Error) => void) | null
  private maxFramesPerTurn: number
  private maxBytesPerTurn: number
  private maxTurnMs: number
  private now: () => number
  private schedule: (callback: () => void) => unknown
  private cancelScheduled: (handle: unknown) => void
  private pause: (() => void) | null
  private resume: (() => void) | null
  private continuationHandle: unknown
  private continuationHandleAssigned = false
  private continuationScheduled = false
  private paused = false
  private draining = false
  private generation = 0

  constructor(
    onFrame: (frame: DecodedFrame) => void,
    onError?: (err: Error) => void,
    options: FrameDecoderOptions = {}
  ) {
    this.onFrame = onFrame
    this.onError = onError ?? null
    this.maxFramesPerTurn = positiveLimit(
      options.maxFramesPerTurn,
      FRAME_DECODER_MAX_FRAMES_PER_TURN
    )
    this.maxBytesPerTurn = positiveLimit(options.maxBytesPerTurn, FRAME_DECODER_MAX_BYTES_PER_TURN)
    this.maxTurnMs = positiveLimit(options.maxTurnMs, FRAME_DECODER_MAX_TURN_MS)
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? ((callback) => setImmediate(callback))
    this.cancelScheduled =
      options.cancelScheduled ?? ((handle) => clearImmediate(handle as NodeJS.Immediate))
    this.pause = options.pause ?? null
    this.resume = options.resume ?? null
  }

  feed(chunk: Buffer | Uint8Array): void {
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    const retained = this.bufferedLength + buf.length
    if (retained > FRAME_DECODER_MAX_RETAINED_BYTES) {
      this.reset()
      this.onError?.(new Error(`Frame decoder retained-input limit exceeded: ${retained}`))
      return
    }
    if (buf.length > 0) {
      this.chunks.push(buf)
      this.bufferedLength += buf.length
    }
    if (!this.draining && !this.continuationScheduled) {
      this.drainTurn()
    }
  }

  reset(): void {
    this.generation += 1
    this.cancelContinuation()
    this.chunks = []
    this.bufferedLength = 0
    this.oversizedPayloadBytesRemaining = 0
    this.releasePause()
  }

  drain(): Buffer {
    const out =
      this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.bufferedLength)
    this.reset()
    return out
  }

  private drainTurn(): void {
    if (this.draining) {
      return
    }
    this.draining = true
    const generation = this.generation
    const startedAt = this.now()
    let frames = 0
    let bytes = 0

    try {
      while (generation === this.generation) {
        if (
          frames >= this.maxFramesPerTurn ||
          bytes >= this.maxBytesPerTurn ||
          (frames > 0 && this.now() - startedAt >= this.maxTurnMs)
        ) {
          break
        }
        const discarded = this.discardOversizedPayload(bytes)
        if (discarded > 0) {
          bytes += discarded
          continue
        }
        if (this.bufferedLength < HEADER_LENGTH) {
          break
        }
        const header = this.peekBytes(HEADER_LENGTH)
        const length = header.readUInt32BE(9)
        if (length > MAX_MESSAGE_SIZE) {
          this.discardBytes(HEADER_LENGTH)
          this.oversizedPayloadBytesRemaining = length
          bytes += HEADER_LENGTH
          this.onError?.(new Error(`Frame payload too large: ${length} bytes — discarded`))
          continue
        }
        const totalLength = HEADER_LENGTH + length
        if (this.bufferedLength < totalLength) {
          break
        }
        if (frames > 0 && bytes + totalLength > this.maxBytesPerTurn) {
          break
        }
        const framed = this.takeBytes(totalLength)
        frames += 1
        bytes += totalLength
        this.onFrame({
          type: framed[0],
          id: framed.readUInt32BE(1),
          ack: framed.readUInt32BE(5),
          payload: framed.subarray(HEADER_LENGTH, totalLength)
        })
      }
    } finally {
      this.draining = false
    }

    if (generation !== this.generation) {
      return
    }
    if (this.hasRunnableWork()) {
      this.scheduleContinuation()
    } else {
      this.releasePause()
    }
  }

  private discardOversizedPayload(bytes: number): number {
    if (this.oversizedPayloadBytesRemaining === 0 || this.bufferedLength === 0) {
      return 0
    }
    const discarded = Math.min(
      this.oversizedPayloadBytesRemaining,
      this.bufferedLength,
      Math.max(1, this.maxBytesPerTurn - bytes)
    )
    this.discardBytes(discarded)
    this.oversizedPayloadBytesRemaining -= discarded
    return discarded
  }

  private hasRunnableWork(): boolean {
    if (this.oversizedPayloadBytesRemaining > 0) {
      return this.bufferedLength > 0
    }
    if (this.bufferedLength < HEADER_LENGTH) {
      return false
    }
    const length = this.peekBytes(HEADER_LENGTH).readUInt32BE(9)
    return length > MAX_MESSAGE_SIZE || this.bufferedLength >= HEADER_LENGTH + length
  }

  private scheduleContinuation(): void {
    if (this.continuationScheduled) {
      return
    }
    const generation = this.generation
    this.continuationScheduled = true
    try {
      this.acquirePause()
    } catch (error) {
      this.continuationScheduled = false
      throw error
    }
    if (generation !== this.generation) {
      this.continuationScheduled = false
      return
    }
    try {
      this.continuationHandle = this.schedule(() => {
        if (!this.continuationScheduled || generation !== this.generation) {
          return
        }
        this.continuationScheduled = false
        this.continuationHandleAssigned = false
        this.continuationHandle = undefined
        this.drainTurn()
      })
      this.continuationHandleAssigned = true
    } catch (error) {
      this.continuationScheduled = false
      this.continuationHandle = undefined
      this.releasePause()
      throw error
    }
  }

  private cancelContinuation(): void {
    if (!this.continuationScheduled) {
      return
    }
    this.continuationScheduled = false
    if (this.continuationHandleAssigned) {
      this.cancelScheduled(this.continuationHandle)
    }
    this.continuationHandleAssigned = false
    this.continuationHandle = undefined
  }

  private acquirePause(): void {
    if (!this.paused) {
      this.paused = true
      try {
        this.pause?.()
      } catch (error) {
        this.paused = false
        throw error
      }
    }
  }

  private releasePause(): void {
    if (this.paused) {
      this.paused = false
      this.resume?.()
    }
  }

  private peekBytes(count: number): Buffer {
    const first = this.chunks[0]
    if (first.length >= count) {
      return first
    }
    const out = Buffer.allocUnsafe(count)
    let copied = 0
    for (const part of this.chunks) {
      copied += part.copy(out, copied, 0, Math.min(part.length, count - copied))
      if (copied >= count) {
        break
      }
    }
    return out
  }

  private takeBytes(count: number): Buffer {
    const first = this.chunks[0]
    if (first.length === count) {
      this.chunks.shift()
      this.bufferedLength -= count
      return first
    }
    if (first.length > count) {
      this.chunks[0] = first.subarray(count)
      this.bufferedLength -= count
      return first.subarray(0, count)
    }
    const out = Buffer.allocUnsafe(count)
    let copied = 0
    while (copied < count) {
      const part = this.chunks[0]
      const take = Math.min(part.length, count - copied)
      part.copy(out, copied, 0, take)
      copied += take
      if (take === part.length) {
        this.chunks.shift()
      } else {
        this.chunks[0] = part.subarray(take)
      }
    }
    this.bufferedLength -= count
    return out
  }

  private discardBytes(count: number): void {
    let remaining = count
    while (remaining > 0) {
      const part = this.chunks[0]
      if (part.length <= remaining) {
        this.chunks.shift()
        remaining -= part.length
      } else {
        this.chunks[0] = part.subarray(remaining)
        remaining = 0
      }
    }
    this.bufferedLength -= count
  }
}

const positiveLimit = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
