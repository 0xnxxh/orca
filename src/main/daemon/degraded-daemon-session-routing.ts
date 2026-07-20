import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import {
  DaemonPtySessionRouting,
  type DaemonPtyInventoryRefresh
} from './daemon-pty-session-routing'
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
    if (this.isAmbiguous(sessionId)) {
      return undefined
    }
    return this.daemonRouting.get(sessionId) ?? this.providers.get(sessionId)
  }

  isAmbiguous(sessionId: string): boolean {
    return (
      this.daemonRouting.isAmbiguous(sessionId) ||
      (this.providers.has(sessionId) && this.daemonRouting.get(sessionId) !== undefined)
    )
  }

  beginInventoryRefresh(): DaemonPtyInventoryRefresh {
    return this.daemonRouting.beginInventoryRefresh()
  }

  finishInventoryRefresh(refresh: DaemonPtyInventoryRefresh): void {
    this.daemonRouting.finishInventoryRefresh(refresh)
  }

  addDaemonInventorySession(
    sessionId: string,
    adapter: DaemonPtyAdapter,
    refresh: DaemonPtyInventoryRefresh
  ): void {
    this.daemonRouting.addInventorySession(sessionId, adapter, refresh)
  }

  add(sessionId: string, provider: DegradedManagedPtyProvider): void {
    if (this.isDaemonAdapter(provider)) {
      this.daemonRouting.add(sessionId, provider)
      return
    }
    this.daemonRouting.recordExternalMutation(sessionId)
    this.providers.set(sessionId, provider)
  }

  remove(sessionId: string, provider: DegradedManagedPtyProvider): void {
    if (this.isDaemonAdapter(provider)) {
      this.daemonRouting.remove(sessionId, provider)
      return
    }
    this.daemonRouting.recordExternalMutation(sessionId)
    if (this.providers.get(sessionId) === provider) {
      this.providers.delete(sessionId)
    }
  }

  refreshSessions(
    fallbackSessions: PtyProcessInfo[],
    daemonResults: PtyProcessInfo[][],
    refresh: DaemonPtyInventoryRefresh
  ): string[] {
    for (const session of fallbackSessions) {
      this.daemonRouting.applyInventoryMutation(session.id, refresh, () => {
        this.providers.set(session.id, this.fallback)
      })
    }
    const ambiguousIds = new Set(
      this.daemonRouting.refreshLive(this.daemonAdapters, daemonResults, refresh)
    )
    for (const sessionId of this.providers.keys()) {
      if (
        this.daemonRouting.get(sessionId) !== undefined ||
        this.daemonRouting.isAmbiguous(sessionId)
      ) {
        ambiguousIds.add(sessionId)
      }
    }
    return [...ambiguousIds].sort()
  }

  idsForDaemon(adapter: DaemonPtyAdapter): string[] {
    return this.daemonRouting.idsFor(adapter)
  }

  daemonFor(sessionId: string): DaemonPtyAdapter | null {
    return this.isAmbiguous(sessionId) ? null : (this.daemonRouting.get(sessionId) ?? null)
  }

  hasPty(sessionId: string): boolean {
    if (this.isAmbiguous(sessionId)) {
      return true
    }
    const routed = this.get(sessionId)
    if (routed) {
      return routed.hasPty?.(sessionId) ?? true
    }
    const discovered = this.discoverExistingProvider(sessionId)
    return this.isAmbiguous(sessionId) || discovered !== undefined
  }

  providerFor(
    sessionId: string,
    ambiguousProvider: DegradedManagedPtyProvider
  ): DegradedManagedPtyProvider {
    if (this.isAmbiguous(sessionId)) {
      return ambiguousProvider
    }
    const routed = this.get(sessionId)
    if (routed) {
      return routed
    }
    const discovered = this.discoverExistingProvider(sessionId)
    return this.isAmbiguous(sessionId) ? ambiguousProvider : (discovered ?? this.fallback)
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
    if (this.isAmbiguous(sessionId)) {
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

  private isDaemonAdapter(provider: DegradedManagedPtyProvider): provider is DaemonPtyAdapter {
    return this.daemonAdapters.includes(provider as DaemonPtyAdapter)
  }
}
