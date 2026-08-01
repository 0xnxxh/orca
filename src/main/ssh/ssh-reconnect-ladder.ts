import { RECONNECT_BACKOFF_MS } from './ssh-connection-utils'

// A connection that held this long is treated as healthy, so the next drop restarts the delay ladder.
export const STABLE_CONNECTION_MS = 60_000

export type SshReconnectDecision =
  | { kind: 'retry'; delayMs: number; attemptIndex: number }
  | { kind: 'give-up' }

/**
 * Why two counters: `delayIndex` advances on every scheduled retry (flap or handshake failure) so a
 * host that keeps dropping after a successful handshake still backs off, while
 * `consecutiveFailedAttempts` advances only on a failed connect attempt so 'reconnection-failed'
 * stays reachable exactly after RECONNECT_BACKOFF_MS.length failed handshakes — never after flaps.
 */
export class SshReconnectLadder {
  private delayIndex = 0
  private consecutiveFailedAttempts = 0
  private connectedAtMs: number | null = null

  next(nowMs: number): SshReconnectDecision {
    const connectedAt = this.connectedAtMs
    // Why: consume it — one reset per connection, never a rolling reset mid-outage (the table sums past the window).
    this.connectedAtMs = null
    if (connectedAt !== null && nowMs - connectedAt >= STABLE_CONNECTION_MS) {
      this.delayIndex = 0
    }
    if (this.consecutiveFailedAttempts >= RECONNECT_BACKOFF_MS.length) {
      return { kind: 'give-up' }
    }
    const attemptIndex = Math.min(this.delayIndex, RECONNECT_BACKOFF_MS.length - 1)
    this.delayIndex = attemptIndex + 1
    return { kind: 'retry', delayMs: RECONNECT_BACKOFF_MS[attemptIndex], attemptIndex }
  }

  markConnected(nowMs: number): void {
    this.consecutiveFailedAttempts = 0
    this.connectedAtMs = nowMs
  }

  markAttemptFailed(): void {
    this.consecutiveFailedAttempts += 1
    this.connectedAtMs = null
  }

  reset(): void {
    this.delayIndex = 0
    this.consecutiveFailedAttempts = 0
    this.connectedAtMs = null
  }
}
