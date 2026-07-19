import {
  isMobileRelayCloseCode,
  mobileRelayRecoveryFor
} from '../../../src/shared/mobile-relay-close-codes'
import type { MobileRelayRpcSession } from './mobile-relay-rpc-session'
import { RelayOuterError } from './mobile-relay-e2ee-link'
import type { StableLogicalRpcClient } from './stable-logical-rpc-client'
import type { ConnectionState } from './types'

// Why: relay resume closes and silent cellular NAT rebinds otherwise cause
// immediate re-dials that ping-pong the phone between connected and disconnected.
const RELAY_BACKOFF_MIN_MS = 250
const RELAY_BACKOFF_BASE_MS = 500
const RELAY_BACKOFF_CEILING_MS = 30_000

export type RelayReconnectDependencies = {
  now: () => number
  randomBytes: (length: number) => Uint8Array
  setTimer: typeof setTimeout
  clearTimer: typeof clearTimeout
}

export class RelayReconnectController {
  private consecutiveFailures = 0
  private nextAttemptAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private activeSession: MobileRelayRpcSession | null = null

  constructor(
    private readonly dependencies: RelayReconnectDependencies,
    private readonly onRetry: (forceReplacement?: boolean) => void
  ) {}

  handleForeground(
    logical: StableLogicalRpcClient,
    wasForeground: boolean,
    forceReplacement: boolean
  ): void {
    if (!wasForeground) {
      // Why: an app resume is a fresh signal, unlike repeated network-flap nudges.
      this.reset()
    } else if (logical.getState() === 'connected') {
      // Why: a network handoff can leave the relay half-open without publishing a close.
      this.suspendActiveRelay(logical)
    }
    this.onRetry(forceReplacement)
  }

  handleStateFailure(logical: StableLogicalRpcClient, state: ConnectionState): void {
    if (!this.needsRecovery(state)) {
      return
    }
    this.registerActiveFailure(logical)
    this.onRetry()
  }

  needsRecovery(state: ConnectionState): boolean {
    return state !== 'connected' && state !== 'connecting' && state !== 'handshaking'
  }

  suspendActiveRelay(logical: StableLogicalRpcClient): void {
    if (logical.getActivePath() !== 'relay') {
      return
    }
    this.activeSession = null
    logical.suspendActiveSession()
  }

  setActiveSession(session: MobileRelayRpcSession): void {
    this.activeSession = session
  }

  resetForDirectConnection(): void {
    this.activeSession = null
    this.reset()
  }

  registerActiveFailure(logical: StableLogicalRpcClient): void {
    if (logical.getActivePath() !== 'relay') {
      return
    }
    const failure = this.activeSession?.getFailure()
    this.activeSession = null
    if (failure) {
      // Why: active relay closes need the same cooldown as failed replacement dials.
      this.registerFailure(failure)
    }
  }

  // True when the caller is still inside the cooldown window and must not
  // re-dial. Arms the self-scheduled retry so recovery still happens on its own.
  shouldDefer(): boolean {
    if (this.dependencies.now() < this.nextAttemptAt) {
      this.scheduleRetry()
      return true
    }
    return false
  }

  registerFailure(error: Error | null): void {
    this.consecutiveFailures += 1
    const code = error instanceof RelayOuterError ? error.code : null
    const recovery =
      code != null && isMobileRelayCloseCode(code)
        ? mobileRelayRecoveryFor(code, 'phone-resume')
        : null
    const delay = this.delayMs()
    this.nextAttemptAt = this.dependencies.now() + delay
    // Why: wait for an OS/direct-probe signal before arming one debounced retry.
    if (
      recovery?.kind === 'wait-for-host-revival' ||
      recovery?.kind === 'disable-relay-credential'
    ) {
      this.clearTimer()
      return
    }
    this.scheduleRetry(delay)
  }

  reset(): void {
    this.consecutiveFailures = 0
    this.nextAttemptAt = 0
    this.clearTimer()
  }

  clear(): void {
    this.clearTimer()
    this.activeSession = null
  }

  private clearTimer(): void {
    if (this.timer) {
      this.dependencies.clearTimer(this.timer)
      this.timer = null
    }
  }

  private scheduleRetry(delayMs?: number): void {
    if (this.timer) {
      return
    }
    const delay = delayMs ?? Math.max(0, this.nextAttemptAt - this.dependencies.now())
    this.timer = this.dependencies.setTimer(() => {
      this.timer = null
      this.onRetry()
    }, delay)
  }

  private delayMs(): number {
    const exponent = Math.max(0, this.consecutiveFailures - 1)
    const cap = Math.min(RELAY_BACKOFF_CEILING_MS, RELAY_BACKOFF_BASE_MS * 2 ** exponent)
    // Full jitter (uniform in [0, cap)), floored so retries never busy-loop.
    return Math.max(RELAY_BACKOFF_MIN_MS, Math.floor(cap * this.jitterFraction()))
  }

  private jitterFraction(): number {
    const [high, low] = this.dependencies.randomBytes(2)
    return (((high ?? 0) << 8) | (low ?? 0)) / 0x1_00_00
  }
}
