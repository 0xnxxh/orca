import { describe, expect, it } from 'vitest'
import { parseServeSimDetachedSession } from './serve-sim-detached-session'

describe('parseServeSimDetachedSession', () => {
  it('uses serve-sim streamUrl when present', () => {
    const info = parseServeSimDetachedSession(
      {
        device: 'device-1',
        streamUrl: 'http://127.0.0.1:3100/stream.mjpeg',
        wsUrl: 'ws://127.0.0.1:3100/ws'
      },
      'device-1'
    )

    expect(info).toMatchObject({
      deviceUdid: 'device-1',
      streamUrl: 'http://127.0.0.1:3100/stream.mjpeg',
      wsUrl: 'ws://127.0.0.1:3100/ws'
    })
  })

  it('derives the MJPEG stream endpoint from older serve-sim url output', () => {
    const info = parseServeSimDetachedSession(
      {
        device: 'device-2',
        url: 'http://127.0.0.1:3100',
        wsUrl: 'ws://127.0.0.1:3100/ws'
      },
      'device-2'
    )

    expect(info.streamUrl).toBe('http://127.0.0.1:3100/stream.mjpeg')
  })

  it('derives the ax endpoint when serve-sim omits axUrl', () => {
    const info = parseServeSimDetachedSession(
      {
        device: 'device-1',
        streamUrl: 'http://127.0.0.1:3100/stream.mjpeg',
        wsUrl: 'ws://127.0.0.1:3100/ws'
      },
      'device-1'
    )

    expect(info.axUrl).toBe('http://127.0.0.1:3100/ax')
  })

  it('does not fabricate an ax endpoint from a non-mjpeg stream url', () => {
    const info = parseServeSimDetachedSession(
      {
        device: 'device-1',
        streamUrl: 'http://127.0.0.1:3100/custom-stream',
        wsUrl: 'ws://127.0.0.1:3100/ws'
      },
      'device-1'
    )

    expect(info.axUrl).toBeUndefined()
  })

  it('keeps an explicit axUrl when serve-sim provides one', () => {
    const info = parseServeSimDetachedSession(
      {
        device: 'device-1',
        streamUrl: 'http://127.0.0.1:3100/stream.mjpeg',
        wsUrl: 'ws://127.0.0.1:3100/ws',
        axUrl: 'http://127.0.0.1:3100/custom-ax'
      },
      'device-1'
    )

    expect(info.axUrl).toBe('http://127.0.0.1:3100/custom-ax')
  })
})
