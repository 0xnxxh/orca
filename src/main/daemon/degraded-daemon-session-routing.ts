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
  private routing = new DaemonPtySessionRouting<DegradedManagedPtyProvider>()

  constructor(
    private fallback: DegradedManagedPtyProvider,
    private daemonAdapters: DaemonPtyAdapter[]
  ) {}

  get(sessionId: string): DegradedManagedPtyProvider | undefined {
    return this.routing.get(sessionId)
  }

  isAmbiguous(sessionId: string): boolean {
    return this.routing.isAmbiguous(sessionId)
  }

  beginInventoryRefresh(): DaemonPtyInventoryRefresh {
    return this.routing.beginInventoryRefresh()
  }

  finishInventoryRefresh(refresh: DaemonPtyInventoryRefresh): void {
    this.routing.finishInventoryRefresh(refresh)
  }

  add(sessionId: string, provider: DegradedManagedPtyProvider): void {
    this.routing.add(sessionId, provider)
  }

  remove(sessionId: string, provider: DegradedManagedPtyProvider): boolean {
    return this.routing.remove(sessionId, provider)
  }

  handleExit(sessionId: string, provider: DegradedManagedPtyProvider): boolean {
    return this.routing.handleExit(sessionId, provider)
  }

  beginSleep(sessionId: string, provider: DegradedManagedPtyProvider): void {
    this.routing.beginSleep(sessionId, provider)
  }

  cancelSleep(sessionId: string, provider: DegradedManagedPtyProvider): void {
    this.routing.cancelSleep(sessionId, provider)
  }

  async shutdown(
    sessionId: string,
    provider: DegradedManagedPtyProvider,
    opts: { immediate?: boolean; keepHistory?: boolean; deadlineMs?: number }
  ): Promise<void> {
    if (opts.keepHistory) {
      this.beginSleep(sessionId, provider)
    }
    try {
      await provider.shutdown(sessionId, opts)
    } catch (error) {
      if (opts.keepHistory) {
        this.cancelSleep(sessionId, provider)
      }
      throw error
    }
    if (!opts.keepHistory) {
      this.remove(sessionId, provider)
    }
  }

  refreshSessions(
    fallbackSessions: PtyProcessInfo[],
    daemonResults: PtyProcessInfo[][],
    refresh: DaemonPtyInventoryRefresh
  ): string[] {
    return this.routing.refreshLive(
      this.allProviders(),
      [fallbackSessions, ...daemonResults],
      refresh
    )
  }

  refreshProvider(
    provider: DegradedManagedPtyProvider,
    sessions: PtyProcessInfo[],
    refresh: DaemonPtyInventoryRefresh
  ): string[] {
    return this.routing.refreshLive([provider], [sessions], refresh)
  }

  idsForDaemon(adapter: DaemonPtyAdapter): string[] {
    return this.routing.idsFor(adapter)
  }

  daemonFor(sessionId: string): DaemonPtyAdapter | null {
    const provider = this.routing.get(sessionId)
    return provider && this.isDaemonAdapter(provider) ? provider : null
  }

  hasPty(sessionId: string): boolean {
    if (this.isAmbiguous(sessionId)) {
      return true
    }
    const routed = this.get(sessionId)
    if (routed) {
      return routed.hasPty?.(sessionId) ?? true
    }
    return this.discoverExistingProvider(sessionId) !== undefined || this.isAmbiguous(sessionId)
  }

  providerFor(
    sessionId: string,
    ambiguousProvider: DegradedManagedPtyProvider
  ): DegradedManagedPtyProvider {
    if (this.isAmbiguous(sessionId)) {
      return ambiguousProvider
    }
    const provider = this.get(sessionId) ?? this.discoverExistingProvider(sessionId)
    return this.isAmbiguous(sessionId) ? ambiguousProvider : (provider ?? this.fallback)
  }

  providerMapFor(provider: DegradedManagedPtyProvider): Map<string, DegradedManagedPtyProvider> {
    return new Map(this.routing.idsFor(provider).map((id) => [id, provider]))
  }

  private discoverExistingProvider(sessionId: string): DegradedManagedPtyProvider | undefined {
    // Why: probing every provider before selecting one prevents an unlisted
    // fallback/daemon collision from being mistaken for unique ownership.
    for (const provider of this.allProviders()) {
      if (provider.hasPty?.(sessionId) === true) {
        this.add(sessionId, provider)
      }
    }
    return this.isAmbiguous(sessionId) ? undefined : this.get(sessionId)
  }

  private isDaemonAdapter(provider: DegradedManagedPtyProvider): provider is DaemonPtyAdapter {
    return this.daemonAdapters.includes(provider as DaemonPtyAdapter)
  }

  private allProviders(): DegradedManagedPtyProvider[] {
    return [this.fallback, ...this.daemonAdapters]
  }
}
