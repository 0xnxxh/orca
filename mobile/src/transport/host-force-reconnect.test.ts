import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostForceReconnectCoordinator } from './host-force-reconnect'

describe('HostForceReconnectCoordinator', () => {
  afterEach(() => vi.useRealTimers())

  it('bounds a first reconnect when its same-profile open never settles', async () => {
    vi.useFakeTimers()
    const cancelPendingOpen = vi.fn()
    const coordinator = new HostForceReconnectCoordinator()
    const reconnect = coordinator.run({
      hostId: 'host-1',
      profileVersion: 0,
      getEntry: () => undefined,
      getListenerCount: () => 1,
      removeEntry: vi.fn(),
      cancelPendingOpen,
      openReplacement: () => new Promise<never>(() => {})
    })
    const outcome = reconnect.catch((error: Error) => error.message)

    expect(cancelPendingOpen).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(14_999)
    expect(cancelPendingOpen).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)

    await expect(outcome).resolves.toBe('Force Reconnect timed out')
    expect(cancelPendingOpen).toHaveBeenCalledTimes(2)
  })
})
