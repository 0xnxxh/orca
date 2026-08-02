// Why: suppress a known-missing RPC surface without pinning it forever — an
// in-place codex upgrade during a long Orca session self-heals after the
// interval, mirroring GitCapabilityCache's rationale.
export const CODEX_APP_SERVER_CAPABILITY_RETRY_INTERVAL_MS = 30 * 60_000

/** Execution host that runs the codex binary. WSL distros are isolated from
 *  the native host and from each other — each can carry a different codex. */
export type CodexAppServerHostKey = 'native' | `wsl:${string}`

type AsyncProbeState =
  | { outcome: 'supported' }
  | { outcome: 'unsupported' }
  | { outcome: 'transient-error'; error: unknown }

export function getCodexAppServerHostKey(
  host: { kind: 'native' } | { kind: 'wsl'; distro: string }
): CodexAppServerHostKey {
  return host.kind === 'wsl' ? `wsl:${host.distro}` : 'native'
}

/**
 * Capability cache for codex app-server RPC surfaces, modeled on
 * GitCapabilityCache. Synchronous launch probes use the direct cache; async
 * restart probes coalesce the first unknown-capability call per host.
 */
export class CodexAppServerCapabilityCache {
  private readonly retryAfterByHost = new Map<CodexAppServerHostKey, number>()
  private readonly supportedHosts = new Set<CodexAppServerHostKey>()
  private readonly inFlightProbeByHost = new Map<CodexAppServerHostKey, Promise<AsyncProbeState>>()

  shouldTry(hostKey: CodexAppServerHostKey, nowMs = Date.now()): boolean {
    const retryAfterMs = this.retryAfterByHost.get(hostKey)
    if (retryAfterMs === undefined) {
      return true
    }
    if (nowMs < retryAfterMs) {
      return false
    }
    this.retryAfterByHost.delete(hostKey)
    return true
  }

  isKnownSupported(hostKey: CodexAppServerHostKey): boolean {
    return this.supportedHosts.has(hostKey)
  }

  rememberUnsupported(hostKey: CodexAppServerHostKey, nowMs = Date.now()): void {
    this.supportedHosts.delete(hostKey)
    this.retryAfterByHost.set(hostKey, nowMs + CODEX_APP_SERVER_CAPABILITY_RETRY_INTERVAL_MS)
  }

  rememberSupported(hostKey: CodexAppServerHostKey): void {
    this.retryAfterByHost.delete(hostKey)
    this.supportedHosts.add(hostKey)
  }

  runWithFallbackSync<T>(
    hostKey: CodexAppServerHostKey,
    runPreferred: () => T,
    runFallback: () => T,
    isUnsupportedError: (error: unknown) => boolean,
    nowMs = Date.now()
  ): T {
    if (!this.supportedHosts.has(hostKey) && !this.shouldTry(hostKey, nowMs)) {
      return runFallback()
    }
    try {
      const result = runPreferred()
      this.rememberSupported(hostKey)
      return result
    } catch (error) {
      // Why: only a positive absence signal (unknown method / missing
      // subcommand) marks unsupported. Transient spawn failures, timeouts,
      // and RPC errors fall back once without poisoning the capability.
      if (!isUnsupportedError(error)) {
        throw error
      }
      this.rememberUnsupported(hostKey, nowMs)
      return runFallback()
    }
  }

  async runWithFallbackAsync<T>(
    hostKey: CodexAppServerHostKey,
    runPreferred: () => Promise<T>,
    runFallback: () => T | Promise<T>,
    isUnsupportedError: (error: unknown) => boolean,
    nowMs = Date.now()
  ): Promise<T> {
    if (this.supportedHosts.has(hostKey)) {
      return this.runKnownAsync(runPreferred, runFallback, hostKey, isUnsupportedError, nowMs)
    }
    if (!this.shouldTry(hostKey, nowMs)) {
      return runFallback()
    }

    const existingProbe = this.inFlightProbeByHost.get(hostKey)
    if (existingProbe) {
      const state = await existingProbe
      if (state.outcome === 'unsupported') {
        return runFallback()
      }
      if (state.outcome === 'transient-error') {
        throw state.error
      }
      return this.runKnownAsync(runPreferred, runFallback, hostKey, isUnsupportedError, nowMs)
    }

    let preferredResult!: T
    let probe!: Promise<AsyncProbeState>
    probe = (async (): Promise<AsyncProbeState> => {
      try {
        // Defer invocation until after the promise is registered so a
        // synchronous throw still updates the shared capability state.
        preferredResult = await Promise.resolve().then(runPreferred)
        if (this.inFlightProbeByHost.get(hostKey) === probe) {
          this.rememberSupported(hostKey)
        }
        return { outcome: 'supported' }
      } catch (error) {
        if (isUnsupportedError(error)) {
          if (this.inFlightProbeByHost.get(hostKey) === probe) {
            this.rememberUnsupported(hostKey, nowMs)
          }
          return { outcome: 'unsupported' }
        }
        return { outcome: 'transient-error', error }
      }
    })()
    this.inFlightProbeByHost.set(hostKey, probe)
    const state = await probe
    if (this.inFlightProbeByHost.get(hostKey) === probe) {
      this.inFlightProbeByHost.delete(hostKey)
    }
    if (state.outcome === 'unsupported') {
      return runFallback()
    }
    if (state.outcome === 'transient-error') {
      throw state.error
    }
    return preferredResult
  }

  private async runKnownAsync<T>(
    runPreferred: () => Promise<T>,
    runFallback: () => T | Promise<T>,
    hostKey: CodexAppServerHostKey,
    isUnsupportedError: (error: unknown) => boolean,
    nowMs: number
  ): Promise<T> {
    try {
      return await runPreferred()
    } catch (error) {
      if (!isUnsupportedError(error)) {
        throw error
      }
      this.rememberUnsupported(hostKey, nowMs)
      return runFallback()
    }
  }

  clear(): void {
    this.retryAfterByHost.clear()
    this.supportedHosts.clear()
    this.inFlightProbeByHost.clear()
  }
}

export const codexAppServerCapabilityCache = new CodexAppServerCapabilityCache()
