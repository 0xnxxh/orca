import type { IPtyProvider, PtySpawnOptions, PtySpawnResult } from '../providers/types'

export const DEGRADED_DAEMON_RECOVERY_RETRY_MS = 30_000

export class DegradedDaemonFreshSpawnRouter {
  private target: IPtyProvider
  private recovery: Promise<boolean> | null = null
  private retryAfterMs = 0

  constructor(
    private readonly current: IPtyProvider,
    private readonly fallback: IPtyProvider,
    private readonly sessionProviders: Map<string, IPtyProvider>,
    private readonly probeCurrent: (() => Promise<boolean>) | null
  ) {
    this.target = fallback
  }

  get routesToFallback(): true | undefined {
    return this.target === this.fallback ? true : undefined
  }

  supportsGitGuardHost(sessionId?: string): boolean {
    const provider = (sessionId ? this.sessionProviders.get(sessionId) : undefined) ?? this.target
    return provider.supportsGitCredentialGuardHost?.(sessionId) === true
  }

  canProvideSnapshot(sessionId: string): boolean {
    return (
      this.sessionProviders.get(sessionId)?.canProvideAuthoritativeBufferSnapshot?.(sessionId) ===
      true
    )
  }

  async recover(): Promise<boolean> {
    if (this.target === this.current) {
      return true
    }
    if (!this.probeCurrent) {
      return false
    }
    if (Date.now() < this.retryAfterMs) {
      return false
    }
    if (this.recovery) {
      return this.recovery
    }
    const recovery = this.probeCurrent()
      .catch(() => false)
      .then((healthy) => {
        if (healthy) {
          this.target = this.current
          console.info('[daemon] PTY spawn health recovered; fresh terminals are daemon-backed')
        } else {
          this.retryAfterMs = Date.now() + DEGRADED_DAEMON_RECOVERY_RETRY_MS
        }
        return healthy
      })
      .finally(() => {
        if (this.recovery === recovery) {
          this.recovery = null
        }
      })
    this.recovery = recovery
    return recovery
  }

  async spawn(opts: PtySpawnOptions): Promise<PtySpawnResult> {
    const mapped = opts.sessionId ? this.sessionProviders.get(opts.sessionId) : undefined
    const target = mapped ?? this.target
    let result: PtySpawnResult
    try {
      result = await target.spawn(opts)
    } catch (error) {
      // Why route back: recovery was a one-way flip on a two-way condition. A daemon that
      // answers one health check and wedges again kept every later spawn pointed at it, and a
      // spawn there costs a hello timeout plus a full launcher re-classification — per terminal,
      // for the rest of the session. Sending the next one to the fallback costs a terminal
      // without daemon persistence instead, and the next probe can promote it back.
      if (target === this.current) {
        if (opts.sessionId) {
          // Why pin instead of demote: a spawn that names a session may already have created it
          // on the daemon — the reply can time out after the daemon has acted. Demoting would
          // send the retry to the fallback, which would answer with a fresh local shell under
          // the same id while the original keeps running, and the pane would bind to the shell.
          // `!mapped` cannot tell that apart from a genuinely new session, because the mapping
          // is only recorded after a reply arrives. So the identity sticks to the provider that
          // may own it, and only anonymous spawns move the shared route.
          this.sessionProviders.set(opts.sessionId, target)
        } else {
          this.target = this.fallback
          this.retryAfterMs = Date.now() + DEGRADED_DAEMON_RECOVERY_RETRY_MS
          console.warn(
            '[daemon] Fresh terminals routed back to the local provider: the daemon failed a spawn after recovering'
          )
        }
      }
      throw error
    }
    if (!result.exitedBeforeSpawnReply) {
      this.sessionProviders.set(result.id, target)
    }
    return result
  }
}
