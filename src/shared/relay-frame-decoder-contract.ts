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
