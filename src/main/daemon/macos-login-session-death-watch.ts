import type { LoginPreflightOutcome } from '../providers/macos-tcc-login-shell'
import type { DaemonFileLog } from './daemon-file-log'
import type { SystemResolverHealth } from './types'

// Why: three conclusive PAM verdicts spread over recheck intervals keep a transient
// rejection storm (PAM db reload, OS update) from retiring a daemon whose login
// session is still alive; a real logout rejects conclusively on every probe.
const REQUIRED_CONSECUTIVE_REJECTIONS = 3
// Why: a healthy session answers the PAM probe in milliseconds; probes that die by
// timeout repeatedly are a hang-shaped death signature (PAM blocking on a torn-down
// session). Higher threshold than rejections because load can also slow probes.
const REQUIRED_CONSECUTIVE_TIMEOUTS = 5
const PERIODIC_PROBE_MS = 120_000
const REJECTION_RECHECK_MS = 10_000
const PTY_EXIT_DEBOUNCE_MS = 2_000
// Why: a client hello right after login is the fastest death signal for a stale
// daemon, but steady reconnects must not turn hellos into a PAM probe storm.
const CLIENT_ACTIVITY_MIN_GAP_MS = 30_000
const MIN_PROBE_GAP_MS = 5_000

type WatchClock = {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
  now(): number
}

export type MacosLoginSessionDeathWatchOptions = {
  /** Fresh PAM probe (cache-bypassing); null when the login wrapper doesn't apply on this host. */
  probeLoginSession: () => Promise<LoginPreflightOutcome | null>
  readResolverHealth: () => Promise<SystemResolverHealth>
  onRetire: (details: {
    cause: 'pam-rejections' | 'probe-timeouts'
    rejections: number
    resolverHealth: SystemResolverHealth
  }) => void
  log: DaemonFileLog
  /** Direct-construction seam for deterministic tests; production uses real timers. */
  clock?: WatchClock
  timing?: Partial<{
    periodicProbeMs: number
    rejectionRecheckMs: number
    ptyExitDebounceMs: number
    clientActivityMinGapMs: number
    minProbeGapMs: number
  }>
}

/**
 * Detects that the macOS GUI login session this daemon was born into has died
 * (full logout / WindowServer session teardown) and retires the daemon so the
 * next app start cold-starts a replacement inside the live session (#7936).
 *
 * A daemon in a dead login session is unsalvageable: its PAM context can no
 * longer host `login(1)` spawns ("Login incorrect" zombies) and its Mach
 * bootstrap namespace has lost the system DNS resolver, so every terminal it
 * hosts has no egress. Retirement is the only converging heal.
 *
 * The oracle is the existing TCC login-shell PAM probe: it conclusively accepts
 * while the session is valid — including fast-user-switched-away sessions — and
 * conclusively rejects once the session is destroyed. A hang-shaped death
 * (probes repeatedly dying by timeout, which a live session never does) is a
 * second, higher-threshold trigger. Retirement additionally requires the
 * in-process system resolver to be degraded, so a PAM anomaly alone can never
 * kill a healthy daemon.
 */
export class MacosLoginSessionDeathWatch {
  private readonly probeLoginSession: MacosLoginSessionDeathWatchOptions['probeLoginSession']
  private readonly readResolverHealth: MacosLoginSessionDeathWatchOptions['readResolverHealth']
  private readonly onRetire: MacosLoginSessionDeathWatchOptions['onRetire']
  private readonly log: DaemonFileLog
  private readonly clock: WatchClock
  private readonly periodicProbeMs: number
  private readonly rejectionRecheckMs: number
  private readonly ptyExitDebounceMs: number
  private readonly clientActivityMinGapMs: number
  private readonly minProbeGapMs: number

  // Why: retire only a daemon that once proved its session could host login(1);
  // a host where the wrapper never worked has no death signal to trust.
  private armed = false
  private consecutiveRejections = 0
  private consecutiveTimeouts = 0
  private lastProbeStartedAtMs: number | null = null
  private probeInFlight = false
  private stopped = false
  private retired = false
  private scheduledProbeTimer: unknown | null = null
  private ptyExitDebounceTimer: unknown | null = null

  constructor(opts: MacosLoginSessionDeathWatchOptions) {
    this.probeLoginSession = opts.probeLoginSession
    this.readResolverHealth = opts.readResolverHealth
    this.onRetire = opts.onRetire
    this.log = opts.log
    this.clock = opts.clock ?? {
      setTimeout: (callback, delayMs) => {
        const timer = setTimeout(callback, delayMs)
        timer.unref()
        return timer
      },
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      now: () => Date.now()
    }
    this.periodicProbeMs = opts.timing?.periodicProbeMs ?? PERIODIC_PROBE_MS
    this.rejectionRecheckMs = opts.timing?.rejectionRecheckMs ?? REJECTION_RECHECK_MS
    this.ptyExitDebounceMs = opts.timing?.ptyExitDebounceMs ?? PTY_EXIT_DEBOUNCE_MS
    this.clientActivityMinGapMs = opts.timing?.clientActivityMinGapMs ?? CLIENT_ACTIVITY_MIN_GAP_MS
    this.minProbeGapMs = opts.timing?.minProbeGapMs ?? MIN_PROBE_GAP_MS
  }

  start(): void {
    if (this.stopped) {
      return
    }
    void this.runProbe('startup')
  }

  stop(): void {
    this.stopped = true
    if (this.scheduledProbeTimer !== null) {
      this.clock.clearTimeout(this.scheduledProbeTimer)
      this.scheduledProbeTimer = null
    }
    if (this.ptyExitDebounceTimer !== null) {
      this.clock.clearTimeout(this.ptyExitDebounceTimer)
      this.ptyExitDebounceTimer = null
    }
  }

  /** A mass PTY-exit burst is what a logout's SIGHUP sweep looks like from inside the daemon. */
  notifyPtyExit(): void {
    if (this.stopped || this.ptyExitDebounceTimer !== null) {
      return
    }
    this.ptyExitDebounceTimer = this.clock.setTimeout(() => {
      this.ptyExitDebounceTimer = null
      void this.runProbe('pty-exit')
    }, this.ptyExitDebounceMs)
  }

  notifyClientActivity(): void {
    if (this.stopped) {
      return
    }
    if (
      this.lastProbeStartedAtMs !== null &&
      this.clock.now() - this.lastProbeStartedAtMs < this.clientActivityMinGapMs
    ) {
      return
    }
    void this.runProbe('client-hello')
  }

  private scheduleNextProbe(delayMs: number): void {
    if (this.stopped) {
      return
    }
    if (this.scheduledProbeTimer !== null) {
      this.clock.clearTimeout(this.scheduledProbeTimer)
    }
    this.scheduledProbeTimer = this.clock.setTimeout(() => {
      this.scheduledProbeTimer = null
      void this.runProbe('periodic')
    }, delayMs)
  }

  private async runProbe(trigger: string): Promise<void> {
    if (this.stopped || this.retired || this.probeInFlight) {
      return
    }
    if (
      trigger !== 'startup' &&
      this.lastProbeStartedAtMs !== null &&
      this.clock.now() - this.lastProbeStartedAtMs < this.minProbeGapMs
    ) {
      return
    }
    this.probeInFlight = true
    this.lastProbeStartedAtMs = this.clock.now()
    try {
      const outcome = await this.probeLoginSession()
      if (this.stopped || this.retired) {
        return
      }
      if (outcome === null) {
        // Why: no wrapper machinery means no PAM oracle — watching would only ever misfire.
        this.log.log('login-session-watch-disabled', { trigger })
        this.stop()
        return
      }
      if (!outcome.conclusive) {
        if (this.armed && outcome.reason === 'timeout') {
          // Why: healthy sessions answer in milliseconds even under load; a streak of
          // SIGKILL-by-bound probes is PAM blocking on a torn-down session (the one
          // failure shape a conclusive-verdict trigger would miss).
          this.consecutiveTimeouts++
          this.log.log('login-session-probe-timeout', {
            trigger,
            timeouts: this.consecutiveTimeouts
          })
          if (this.consecutiveTimeouts >= REQUIRED_CONSECUTIVE_TIMEOUTS) {
            await this.retireIfResolverDegraded('probe-timeouts', () => {
              this.consecutiveTimeouts = REQUIRED_CONSECUTIVE_TIMEOUTS - 1
            })
            return
          }
          this.scheduleNextProbe(this.rejectionRecheckMs)
          return
        }
        this.scheduleNextProbe(this.periodicProbeMs)
        return
      }
      this.consecutiveTimeouts = 0
      if (outcome.ok) {
        if (!this.armed) {
          this.log.log('login-session-watch-armed', { trigger })
        }
        this.armed = true
        this.consecutiveRejections = 0
        this.scheduleNextProbe(this.periodicProbeMs)
        return
      }
      if (!this.armed) {
        // Session never hosted login(1) here; the preflight already degraded spawns.
        this.scheduleNextProbe(this.periodicProbeMs)
        return
      }
      this.consecutiveRejections++
      this.log.log('login-session-probe-rejected', {
        trigger,
        rejections: this.consecutiveRejections
      })
      if (this.consecutiveRejections < REQUIRED_CONSECUTIVE_REJECTIONS) {
        this.scheduleNextProbe(this.rejectionRecheckMs)
        return
      }
      await this.retireIfResolverDegraded('pam-rejections', () => {
        this.consecutiveRejections = REQUIRED_CONSECUTIVE_REJECTIONS - 1
      })
    } catch (error) {
      // Why: a probe failure is diagnostic only; an escaped rejection would trip the
      // daemon's fatal unhandled-error path and kill live terminals.
      this.log.log('login-session-probe-error', { message: (error as Error)?.message })
      this.scheduleNextProbe(this.periodicProbeMs)
    } finally {
      this.probeInFlight = false
    }
  }

  private async retireIfResolverDegraded(
    cause: 'pam-rejections' | 'probe-timeouts',
    holdAtThreshold: () => void
  ): Promise<void> {
    const resolverHealth = await this.readResolverHealth()
    if (this.stopped || this.retired) {
      return
    }
    if (resolverHealth === 'healthy') {
      // Why: a live session always has DNS configuration; the PAM anomaly alone must
      // hold at the threshold and keep re-verdicting instead of killing live terminals.
      this.log.log('login-session-retire-suppressed', { cause, resolverHealth })
      holdAtThreshold()
      this.scheduleNextProbe(this.rejectionRecheckMs)
      return
    }
    this.retired = true
    this.onRetire({ cause, rejections: this.consecutiveRejections, resolverHealth })
  }
}
