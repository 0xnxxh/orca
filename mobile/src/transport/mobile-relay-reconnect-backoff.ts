import {
  isMobileRelayCloseCode,
  mobileRelayRecoveryFor
} from '../../../src/shared/mobile-relay-close-codes'
import { RelayOuterError } from './mobile-relay-e2ee-link'

// Why: relay resume closes (4408 peer-dropped / 4429 limit-exceeded) and silent
// cellular NAT rebinds otherwise re-dial instantly; a flapping cellular link then
// ping-pongs connect/disconnect. Space retries with the fullJitter backoff the
// mobileRelayRecoveryFor contract prescribes, floored so retries never busy-loop.
const RELAY_BACKOFF_MIN_MS = 250
const RELAY_BACKOFF_BASE_MS = 500
const RELAY_BACKOFF_CEILING_MS = 30_000

export type RelayReconnectBackoffDependencies = {
  now: () => number
  randomBytes: (length: number) => Uint8Array
  setTimer: typeof setTimeout
  clearTimer: typeof clearTimeout
}

// Encapsulates the relay reconnect cooldown: how long to wait after each failed
// resume before the supervisor may re-dial, and the self-scheduled retry that
// fires when no external signal (foreground/probe) would otherwise drive it.
export class RelayReconnectBackoff {
  private consecutiveFailures = 0
  private nextAttemptAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly dependencies: RelayReconnectBackoffDependencies,
    private readonly onRetry: () => void
  ) {}

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
    // Why: honor the documented recovery contract (previously dead code). Every
    // relay close code maps to a fullJitter/backoff recovery, so always debounce
    // nudges by the backoff window.
    const code = error instanceof RelayOuterError ? error.code : null
    const recovery =
      code != null && isMobileRelayCloseCode(code)
        ? mobileRelayRecoveryFor(code, 'phone-resume')
        : null
    const delay = this.delayMs()
    this.nextAttemptAt = this.dependencies.now() + delay
    // Why: HOST_OFFLINE / BAD_OUTER_CREDENTIAL won't clear by retrying the same
    // resume sooner; keep the debounce but let the next external signal
    // (foreground, direct probe, or credential rotation) drive recovery instead.
    if (
      recovery?.kind === 'wait-for-host-revival' ||
      recovery?.kind === 'disable-relay-credential'
    ) {
      return
    }
    this.scheduleRetry(delay)
  }

  reset(): void {
    this.consecutiveFailures = 0
    this.nextAttemptAt = 0
    this.clear()
  }

  clear(): void {
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
