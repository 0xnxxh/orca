import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginSshConnect,
  endSshConnect,
  isSshConnectInFlight,
  resetSshConnectInFlightForTests,
  subscribeSshConnectInFlight
} from './ssh-connect-in-flight'

describe('ssh connect in-flight registry', () => {
  beforeEach(() => {
    resetSshConnectInFlightForTests()
  })

  it('tracks connects per target, so one host dialing does not disable another', () => {
    beginSshConnect('ssh-a')

    expect(isSshConnectInFlight('ssh-a')).toBe(true)
    expect(isSshConnectInFlight('ssh-b')).toBe(false)
  })

  it('clears the target when the connect settles', () => {
    beginSshConnect('ssh-a')
    endSshConnect('ssh-a')

    expect(isSshConnectInFlight('ssh-a')).toBe(false)
  })

  it('notifies subscribers on both edges', () => {
    const listener = vi.fn()
    subscribeSshConnectInFlight(listener)

    beginSshConnect('ssh-a')
    endSshConnect('ssh-a')

    expect(listener).toHaveBeenCalledTimes(2)
  })

  // Why: every surface renders from one registry entry, so a duplicate begin must not
  // emit again — and the paired end must not clear the flag while a connect is still live.
  it('ignores a duplicate begin without re-notifying', () => {
    const listener = vi.fn()
    subscribeSshConnectInFlight(listener)

    beginSshConnect('ssh-a')
    beginSshConnect('ssh-a')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(isSshConnectInFlight('ssh-a')).toBe(true)
  })

  // Why: handleConnect ends in a finally block that can run for a target it never began
  // (early return paths), and a spurious notify would re-render every subscribed card.
  it('ignores an end for a target that was never in flight', () => {
    const listener = vi.fn()
    subscribeSshConnectInFlight(listener)

    endSshConnect('ssh-a')

    expect(listener).not.toHaveBeenCalled()
    expect(isSshConnectInFlight('ssh-a')).toBe(false)
  })

  it('stops notifying after unsubscribe, so unmounted sidebar rows do not leak', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSshConnectInFlight(listener)

    unsubscribe()
    beginSshConnect('ssh-a')

    expect(listener).not.toHaveBeenCalled()
  })
})
