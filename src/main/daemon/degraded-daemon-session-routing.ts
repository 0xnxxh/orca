import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import { DaemonPtySessionRouting } from './daemon-pty-session-routing'
import type { IPtyProvider, PtyProcessInfo } from '../providers/types'

export type DegradedManagedPtyProvider = IPtyProvider & {
  disconnectOnly?: () => Promise<void>
  dispose?: () => void
}

export class DegradedDaemonSessionRouting {
  private providers = new Map<string, DegradedManagedPtyProvider>()
  private daemonRouting = new DaemonPtySessionRouting()

  constructor(
    private fallback: DegradedManagedPtyProvider,
    private daemonAdapters: DaemonPtyAdapter[]
  ) {}

  get(sessionId: string): DegradedManagedPtyProvider | undefined {
    if (this.daemonRouting.isAmbiguous(sessionId)) {
      return undefined
    }
    return this.daemonRouting.get(sessionId) ?? this.providers.get(sessionId)
  }

  isAmbiguous(sessionId: string): boolean {
    return this.daemonRouting.isAmbiguous(sessionId)
  }

  add(sessionId: string, provider: DegradedManagedPtyProvider): void {
    if (this.isDaemonAdapter(provider)) {
      this.daemonRouting.add(sessionId, provider)
      this.syncDaemonProvider(sessionId)
      return
    }
    this.providers.set(sessionId, provider)
  }

  remove(sessionId: string, provider: DegradedManagedPtyProvider): void {
    if (this.isDaemonAdapter(provider)) {
      this.daemonRouting.remove(sessionId, provider)
      this.syncDaemonProvider(sessionId)
      return
    }
    if (this.providers.get(sessionId) === provider) {
      this.providers.delete(sessionId)
    }
  }

  refreshDaemonSessions(results: PtyProcessInfo[][]): string[] {
    const ambiguousIds = this.daemonRouting.refreshLive(this.daemonAdapters, results)
    for (const sessions of results) {
      for (const session of sessions) {
        this.syncDaemonProvider(session.id)
      }
    }
    return ambiguousIds
  }

  idsForDaemon(adapter: DaemonPtyAdapter): string[] {
    return this.daemonRouting.idsFor(adapter)
  }

  daemonFor(sessionId: string): DaemonPtyAdapter | null {
    return this.daemonRouting.get(sessionId) ?? null
  }

  hasPty(sessionId: string): boolean {
    if (this.daemonRouting.isAmbiguous(sessionId)) {
      return true
    }
    const routed = this.get(sessionId)
    if (routed) {
      return routed.hasPty?.(sessionId) ?? true
    }
    const discovered = this.discoverExistingProvider(sessionId)
    return this.daemonRouting.isAmbiguous(sessionId) || discovered !== undefined
  }

  providerFor(
    sessionId: string,
    ambiguousProvider: DegradedManagedPtyProvider
  ): DegradedManagedPtyProvider {
    if (this.daemonRouting.isAmbiguous(sessionId)) {
      return ambiguousProvider
    }
    const routed = this.get(sessionId)
    if (routed) {
      return routed
    }
    const discovered = this.discoverExistingProvider(sessionId)
    return this.daemonRouting.isAmbiguous(sessionId)
      ? ambiguousProvider
      : (discovered ?? this.fallback)
  }

  providerMap(): Map<string, DegradedManagedPtyProvider> {
    return this.providers
  }

  private discoverExistingProvider(sessionId: string): DegradedManagedPtyProvider | undefined {
    for (const adapter of this.daemonAdapters) {
      if (adapter.hasPty(sessionId)) {
        this.add(sessionId, adapter)
      }
    }
    if (this.daemonRouting.isAmbiguous(sessionId)) {
      return undefined
    }
    const daemon = this.get(sessionId)
    if (daemon) {
      return daemon
    }
    if (this.fallback.hasPty?.(sessionId) === true) {
      this.add(sessionId, this.fallback)
      return this.fallback
    }
    return undefined
  }

  private syncDaemonProvider(sessionId: string): void {
    const owner = this.daemonRouting.get(sessionId)
    if (owner) {
      this.providers.set(sessionId, owner)
      return
    }
    const mapped = this.providers.get(sessionId)
    if (mapped && this.isDaemonAdapter(mapped)) {
      this.providers.delete(sessionId)
    }
  }

  private isDaemonAdapter(provider: DegradedManagedPtyProvider): provider is DaemonPtyAdapter {
    return this.daemonAdapters.includes(provider as DaemonPtyAdapter)
  }
}
