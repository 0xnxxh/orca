import { describe, expect, it } from 'vitest'
import {
  MOBILE_INBOUND_BUFFER_OVERFLOW_MESSAGE,
  MOBILE_INBOUND_FRAME_TOO_LARGE_MESSAGE,
  MOBILE_INBOUND_PROCESSING_FAILED_MESSAGE,
  mobileInboundFrameLogDetail
} from './mobile-inbound-frame-queue'

describe('mobile inbound frame log detail', () => {
  it('retains only fixed queue categories', () => {
    expect(mobileInboundFrameLogDetail(new Error(MOBILE_INBOUND_BUFFER_OVERFLOW_MESSAGE))).toBe(
      MOBILE_INBOUND_BUFFER_OVERFLOW_MESSAGE
    )
    expect(mobileInboundFrameLogDetail(new Error(MOBILE_INBOUND_FRAME_TOO_LARGE_MESSAGE))).toBe(
      MOBILE_INBOUND_FRAME_TOO_LARGE_MESSAGE
    )
  })

  it('does not expose unexpected processing errors', () => {
    const secret = 'credential-secret /private/worktree'

    expect(mobileInboundFrameLogDetail(new Error(secret))).toBe(
      MOBILE_INBOUND_PROCESSING_FAILED_MESSAGE
    )
    expect(mobileInboundFrameLogDetail(secret)).toBe(MOBILE_INBOUND_PROCESSING_FAILED_MESSAGE)
  })
})
