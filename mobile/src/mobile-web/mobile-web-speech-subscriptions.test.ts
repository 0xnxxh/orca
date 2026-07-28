import { describe, expect, it, vi } from 'vitest'
import { MobileWebSpeechSubscriptions } from './mobile-web-speech-subscriptions'

describe('MobileWebSpeechSubscriptions', () => {
  it('orders events and drops queued delivery after cancellation', async () => {
    const subscriptions = new MobileWebSpeechSubscriptions()
    let releaseFirst: (() => void) | undefined
    const post = vi.fn((sequence: number) =>
      sequence === 0
        ? new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
        : Promise.resolve()
    )
    subscriptions.start({
      requestId: 'request-1',
      subscriptionId: 'subscription-1',
      post
    })

    subscriptions.post({ status: 'recording' })
    subscriptions.post({ status: 'processing' })
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'))
    expect(subscriptions.cancel('subscription-1')).toBe('request-1')
    releaseFirst?.()

    await Promise.resolve()
    await Promise.resolve()
    expect(post).toHaveBeenCalledOnce()
    expect(post).toHaveBeenCalledWith(0, { status: 'recording' })
  })
})
