import { PTY_CONSUMER_OWNER_RECOVERY_PENDING_ERROR } from '../../shared/pty-consumer-session'

// Why this budget is safe: the relay displaces a still-attached owner outright, so the only refusal
// left is an incumbent grant whose publication has not settled — bounded by one relay response write.
export const SSH_OWNER_RECOVERY_WAIT_MS = 3_000
const SSH_OWNER_RECOVERY_INITIAL_DELAY_MS = 25
const SSH_OWNER_RECOVERY_MAX_DELAY_MS = 250

type SshOwnerRecoveryRetryGate = {
  isCurrent: () => boolean
  onClosed: (listener: () => void) => () => void
}

function waitForRetry(delayMs: number, gate: SshOwnerRecoveryRetryGate): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe = (): void => {}
    const finish = (): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve()
    }
    unsubscribe = gate.onClosed(finish)
    timer = setTimeout(finish, delayMs)
    timer.unref?.()
    if (!gate.isCurrent()) {
      finish()
    }
  })
}

export async function retrySshOwnerRecoveryWhilePublicationPending<T>(
  attempt: () => Promise<T>,
  gate: SshOwnerRecoveryRetryGate,
  waitMs: number = SSH_OWNER_RECOVERY_WAIT_MS
): Promise<T> {
  const deadline = Date.now() + waitMs
  let delayMs = SSH_OWNER_RECOVERY_INITIAL_DELAY_MS
  while (true) {
    try {
      return await attempt()
    } catch (error) {
      if (
        (error as { code?: unknown }).code !== PTY_CONSUMER_OWNER_RECOVERY_PENDING_ERROR ||
        !gate.isCurrent()
      ) {
        throw error
      }
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) {
        throw error
      }
      await waitForRetry(Math.min(delayMs, remainingMs), gate)
      if (!gate.isCurrent()) {
        throw error
      }
      delayMs = Math.min(delayMs * 2, SSH_OWNER_RECOVERY_MAX_DELAY_MS)
    }
  }
}
