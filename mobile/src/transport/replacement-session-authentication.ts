import type { RpcClient } from './rpc-client'

// Why: a migration must not cut over to a session that has only opened a socket — the
// replacement has to reach 'connected' (E2EE authenticated) first, and a relay dial can
// sit in handshaking for seconds, so the wait is bounded by the caller's timeout.
export function waitForAuthenticated(session: RpcClient, timeoutMs: number): Promise<void> {
  if (session.getState() === 'connected') {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = session.onStateChange((state) => {
      if (state === 'connected') {
        finish()
        resolve()
      } else if (state === 'auth-failed' || state === 'disconnected') {
        finish()
        reject(new Error(`replacement session ${state}`))
      }
    })
    timer = setTimeout(() => {
      finish()
      reject(new Error('replacement session authentication timed out'))
    }, timeoutMs)

    function finish(): void {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      unsubscribe()
    }
  })
}
