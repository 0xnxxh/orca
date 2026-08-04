import { afterEach, describe, expect, it, vi } from 'vitest'
import { PTY_CONSUMER_OWNER_RECOVERY_PENDING_ERROR } from '../../shared/pty-consumer-session'
import { retrySshOwnerRecoveryWhilePublicationPending } from './ssh-owner-recovery-retry'

function publicationPendingError(): Error & { code: number } {
  return Object.assign(new Error('Owner grant publication is still pending'), {
    code: PTY_CONSUMER_OWNER_RECOVERY_PENDING_ERROR
  })
}

function openGate() {
  return {
    isCurrent: () => true,
    onClosed: () => () => {}
  }
}

describe('SSH owner recovery retry', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('recovers once the incumbent grant publication settles', async () => {
    vi.useFakeTimers()
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(publicationPendingError())
      .mockRejectedValueOnce(publicationPendingError())
      .mockResolvedValue('recovered')

    const recovery = retrySshOwnerRecoveryWhilePublicationPending(attempt, openGate())
    await vi.advanceTimersByTimeAsync(75)

    await expect(recovery).resolves.toBe('recovered')
    expect(attempt).toHaveBeenCalledTimes(3)
  })

  it('stops at the publication-settlement deadline', async () => {
    vi.useFakeTimers()
    const error = publicationPendingError()
    const attempt = vi.fn<() => Promise<never>>().mockRejectedValue(error)

    const recovery = retrySshOwnerRecoveryWhilePublicationPending(attempt, openGate(), 60)
    const rejection = expect(recovery).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(60)

    await rejection
    expect(attempt).toHaveBeenCalledTimes(3)
  })

  it('does not retry unrelated failures', async () => {
    const error = Object.assign(new Error('stale owner'), { code: -32041 })
    const attempt = vi.fn<() => Promise<never>>().mockRejectedValue(error)

    await expect(retrySshOwnerRecoveryWhilePublicationPending(attempt, openGate())).rejects.toBe(
      error
    )
    expect(attempt).toHaveBeenCalledOnce()
  })

  it('stops waiting when the relay channel closes', async () => {
    vi.useFakeTimers()
    let current = true
    let close: (() => void) | undefined
    const error = publicationPendingError()
    const attempt = vi.fn<() => Promise<never>>().mockRejectedValue(error)
    const recovery = retrySshOwnerRecoveryWhilePublicationPending(attempt, {
      isCurrent: () => current,
      onClosed: (listener) => {
        close = listener
        return () => {
          close = undefined
        }
      }
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(close).toBeTypeOf('function')

    current = false
    close?.()

    await expect(recovery).rejects.toBe(error)
    expect(attempt).toHaveBeenCalledOnce()
  })
})
