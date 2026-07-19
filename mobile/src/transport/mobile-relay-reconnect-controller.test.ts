import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RelayOuterError } from './mobile-relay-e2ee-link'
import { RelayReconnectController } from './mobile-relay-reconnect-controller'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))

describe('relay reconnect controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps one retry timer and cancels it when recovery needs an external signal', () => {
    const onRetry = vi.fn()
    const reconnect = createController(onRetry)

    reconnect.registerFailure(new RelayOuterError(4429))
    reconnect.registerFailure(new RelayOuterError(4408))
    expect(vi.getTimerCount()).toBe(1)

    reconnect.registerFailure(new RelayOuterError(4404))
    expect(vi.getTimerCount()).toBe(0)
    expect(reconnect.shouldDefer()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    vi.runAllTimers()
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('drops a pending relay retry after direct connectivity wins', () => {
    const onRetry = vi.fn()
    const reconnect = createController(onRetry)

    reconnect.registerFailure(new RelayOuterError(4408))
    expect(vi.getTimerCount()).toBe(1)

    reconnect.resetForDirectConnection()
    expect(vi.getTimerCount()).toBe(0)
    vi.runAllTimers()
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('extends forced-rotation retries to the exponential cooldown', () => {
    const reconnect = createController(vi.fn())

    for (let failure = 0; failure < 6; failure++) {
      reconnect.registerFailure(new RelayOuterError(4429), false)
    }

    expect(reconnect.retryDelayMs(5000)).toBe(8000)
    expect(vi.getTimerCount()).toBe(0)
  })
})

function createController(onRetry: () => void): RelayReconnectController {
  return new RelayReconnectController(
    {
      now: Date.now,
      randomBytes: () => new Uint8Array([128, 0]),
      setTimer: setTimeout,
      clearTimer: clearTimeout
    },
    onRetry
  )
}
