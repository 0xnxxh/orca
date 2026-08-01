import { describe, expect, it } from 'vitest'
import { RECONNECT_BACKOFF_MS } from './ssh-connection-utils'
import { SshReconnectLadder, STABLE_CONNECTION_MS } from './ssh-reconnect-ladder'

describe('SshReconnectLadder', () => {
  it('climbs the table across consecutive post-handshake drops', () => {
    const ladder = new SshReconnectLadder()

    ladder.markConnected(0)
    expect(ladder.next(50)).toEqual({ kind: 'retry', delayMs: 1000, attemptIndex: 0 })
    ladder.markConnected(60)
    expect(ladder.next(110)).toEqual({ kind: 'retry', delayMs: 2000, attemptIndex: 1 })

    const rest = [5000, 5000, 10000, 10000, 10000, 30000, 30000]
    let now = 200
    rest.forEach((delayMs, index) => {
      ladder.markConnected(now)
      now += 50
      expect(ladder.next(now)).toEqual({ kind: 'retry', delayMs, attemptIndex: index + 2 })
    })

    // Saturates at the last step instead of going terminal.
    for (let i = 0; i < 3; i++) {
      ladder.markConnected(now)
      now += 50
      expect(ladder.next(now)).toEqual({ kind: 'retry', delayMs: 30000, attemptIndex: 8 })
    }
  })

  it('escalates a post-handshake drop identically to a handshake failure', () => {
    const dropLadder = new SshReconnectLadder()
    const failureLadder = new SshReconnectLadder()
    const dropDelays: number[] = []
    const failureDelays: number[] = []

    let now = 0
    for (let i = 0; i < RECONNECT_BACKOFF_MS.length; i++) {
      dropLadder.markConnected(now)
      now += 50
      const dropDecision = dropLadder.next(now)
      const failureDecision = failureLadder.next(now)
      expect(dropDecision.kind).toBe('retry')
      expect(failureDecision.kind).toBe('retry')
      if (dropDecision.kind === 'retry') {
        dropDelays.push(dropDecision.delayMs)
      }
      if (failureDecision.kind === 'retry') {
        failureDelays.push(failureDecision.delayMs)
      }
      failureLadder.markAttemptFailed()
      now += 50
    }

    expect(dropDelays).toEqual(RECONNECT_BACKOFF_MS)
    expect(failureDelays).toEqual(dropDelays)
  })

  it('never reaches give-up on a flap streak, even with a later handshake failure', () => {
    const ladder = new SshReconnectLadder()
    let now = 0
    for (let i = 0; i < 12; i++) {
      ladder.markConnected(now)
      now += 50
      const decision = ladder.next(now)
      expect(decision.kind).toBe('retry')
      if (decision.kind === 'retry') {
        now += decision.delayMs
      }
    }

    ladder.markAttemptFailed()

    expect(ladder.next(now)).toEqual({ kind: 'retry', delayMs: 30000, attemptIndex: 8 })
  })

  it('gives up only after RECONNECT_BACKOFF_MS.length consecutive failed attempts', () => {
    const ladder = new SshReconnectLadder()
    const decisions: string[] = []

    for (let i = 0; i < RECONNECT_BACKOFF_MS.length; i++) {
      ladder.markAttemptFailed()
      decisions.push(ladder.next(i * 1000).kind)
    }

    expect(decisions.slice(0, RECONNECT_BACKOFF_MS.length - 1)).toEqual(
      Array(RECONNECT_BACKOFF_MS.length - 1).fill('retry')
    )
    expect(decisions.at(-1)).toBe('give-up')
  })

  it('resets the delay ladder exactly once for a stable connection', () => {
    const ladder = new SshReconnectLadder()
    for (let i = 0; i < 5; i++) {
      ladder.next(i)
    }

    ladder.markConnected(0)
    expect(ladder.next(STABLE_CONNECTION_MS)).toEqual({
      kind: 'retry',
      delayMs: 1000,
      attemptIndex: 0
    })
    // The consumed timestamp must not reset the ladder again later in the same outage.
    expect(ladder.next(STABLE_CONNECTION_MS * 4)).toEqual({
      kind: 'retry',
      delayMs: 2000,
      attemptIndex: 1
    })
  })

  it('does not let a dead host self-reset past the give-up bound', () => {
    const ladder = new SshReconnectLadder()
    ladder.markConnected(0)

    let now = 0
    let last = ladder.next(now)
    for (let i = 0; i < RECONNECT_BACKOFF_MS.length; i++) {
      ladder.markAttemptFailed()
      now += STABLE_CONNECTION_MS * 2
      last = ladder.next(now)
    }

    expect(last).toEqual({ kind: 'give-up' })
  })

  it('returns to the head of the ladder after reset()', () => {
    const ladder = new SshReconnectLadder()
    for (let i = 0; i < RECONNECT_BACKOFF_MS.length; i++) {
      ladder.markAttemptFailed()
      ladder.next(i)
    }

    ladder.reset()

    expect(ladder.next(0)).toEqual({ kind: 'retry', delayMs: 1000, attemptIndex: 0 })
  })
})
