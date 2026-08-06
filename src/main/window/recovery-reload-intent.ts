import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

export const RECOVERY_RELOAD_INTENT_TTL_MS = 30_000

type RecoveryReloadIntentState = {
  token: string
  webContentsId: number
  remainingMs: number
  lastObservedAt: number
}

type RecoveryReloadIntentOptions = {
  now?: () => number
  createToken?: () => string
  durationMs?: number
}

export type RecoveryReloadIntent = {
  begin: (webContentsId: number) => string
  cancel: (webContentsId: number, token: string) => boolean
  consume: (webContentsId: number) => boolean
}

export function createRecoveryReloadIntent({
  // Monotonic; on Windows it also advances while the system is suspended.
  now = () => performance.now(),
  createToken = randomUUID,
  durationMs = RECOVERY_RELOAD_INTENT_TTL_MS
}: RecoveryReloadIntentOptions = {}): RecoveryReloadIntent {
  let state: RecoveryReloadIntentState | null = null

  const currentState = (): RecoveryReloadIntentState | null => {
    if (!state) {
      return null
    }
    const observedAt = now()
    if (observedAt < state.lastObservedAt) {
      state = { ...state, remainingMs: durationMs, lastObservedAt: observedAt }
      return state
    }
    const elapsedMs = observedAt - state.lastObservedAt
    if (elapsedMs >= state.remainingMs) {
      state = null
      return null
    }
    state = {
      ...state,
      remainingMs: state.remainingMs - elapsedMs,
      lastObservedAt: observedAt
    }
    return state
  }

  return {
    begin(webContentsId) {
      const token = createToken()
      state = { token, webContentsId, remainingMs: durationMs, lastObservedAt: now() }
      return token
    },
    cancel(webContentsId, token) {
      const current = currentState()
      if (current?.webContentsId !== webContentsId || current.token !== token) {
        return false
      }
      state = null
      return true
    },
    consume(webContentsId) {
      const current = currentState()
      if (current?.webContentsId !== webContentsId) {
        return false
      }
      state = null
      return true
    }
  }
}
