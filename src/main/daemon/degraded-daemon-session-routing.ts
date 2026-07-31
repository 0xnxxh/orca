import type { IPtyProvider, PtySpawnOptions, PtySpawnResult } from '../providers/types'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import { shutdownDegradedFallbackSessions } from './degraded-daemon-fallback-shutdown'
import { DaemonSessionRouteTable } from './daemon-session-route-table'
import { DaemonSessionOwnerUnknownError, sameDaemonIncarnation } from './daemon-session-route'
import type { DaemonSnapshotAcknowledgementRoutes } from './daemon-snapshot-acknowledgement-routes'
import { DegradedFallbackSpawnRoutes } from './degraded-fallback-spawn-routes'

export class DegradedDaemonSessionRouting {
  private readonly adapters: DaemonPtyAdapter[]
  private readonly adapterSet: ReadonlySet<DaemonPtyAdapter>
  private readonly routes: DaemonSessionRouteTable
  private readonly fallbackSessions = new Map<string, IPtyProvider>()
  private readonly fallbackCollisions = new Set<string>()
  private readonly fallbackSpawns = new DegradedFallbackSpawnRoutes()
  private readonly identityUnsubscribes: (() => void)[] = []

  constructor(
    private readonly current: DaemonPtyAdapter,
    legacy: readonly DaemonPtyAdapter[],
    private readonly fallback: IPtyProvider,
    private readonly snapshotAcks: DaemonSnapshotAcknowledgementRoutes
  ) {
    this.adapters = [current, ...legacy]
    this.adapterSet = new Set(this.adapters)
    this.routes = new DaemonSessionRouteTable(this.adapters)
    for (const adapter of this.adapters) {
      this.identityUnsubscribes.push(
        adapter.onDaemonIdentityChanged(({ previous }) => {
          this.snapshotAcks.dropAdapterIncarnation(adapter, previous)
          this.routes.markOwnerUnavailable(adapter, previous)
        })
      )
    }
  }

  async discover(): Promise<void> {
    for (const adapter of this.adapters) {
      try {
        const before = adapter.getLastAuthenticatedDaemonIdentity()
        const sessions = await adapter.listProcesses()
        const incarnation = adapter.getLastAuthenticatedDaemonIdentity()
        if (before && !sameDaemonIncarnation(before, incarnation)) {
          throw new Error('daemon incarnation changed during session discovery')
        }
        this.routes.recordCompleteDiscovery(
          adapter,
          sessions.map((session) => session.id),
          incarnation
        )
        for (const session of sessions) {
          if (this.fallbackSessions.has(session.id)) {
            this.fallbackCollisions.add(session.id)
          }
        }
      } catch (error) {
        this.routes.recordDiscoveryFailure(adapter)
        console.warn('[daemon] Failed to discover degraded daemon sessions', error)
      }
    }
  }

  async spawn(opts: PtySpawnOptions): Promise<PtySpawnResult> {
    const target = await this.spawnTarget(opts)
    const inFlightFallbackId = target === this.fallback ? opts.sessionId : undefined
    if (inFlightFallbackId) {
      this.fallbackSpawns.begin(inFlightFallbackId)
    }
    try {
      const result = await target.spawn(opts)
      if (target === this.fallback) {
        if (!this.fallbackSpawns.hasExited(result.id)) {
          this.fallbackSessions.set(result.id, target)
        }
        if (this.routes.get(result.id)) {
          this.fallbackCollisions.add(result.id)
        }
      } else {
        this.routes.recordOwned(result.id, target as DaemonPtyAdapter)
      }
      return result
    } finally {
      if (inFlightFallbackId) {
        this.fallbackSpawns.end(inFlightFallbackId)
      }
    }
  }

  providerFor(sessionId: string): IPtyProvider {
    if (this.fallbackCollisions.has(sessionId)) {
      throw new DaemonSessionOwnerUnknownError(sessionId)
    }
    return this.fallbackSessions.get(sessionId) ?? this.routes.resolveOwnerSync(sessionId)
  }

  ownerForHint(sessionId: string): IPtyProvider | null {
    try {
      return this.providerFor(sessionId)
    } catch {
      return null
    }
  }

  hasPty(sessionId: string): boolean {
    if (this.fallbackCollisions.has(sessionId)) {
      return true
    }
    const fallback = this.fallbackSessions.get(sessionId)
    return fallback ? (fallback.hasPty?.(sessionId) ?? true) : this.routes.hasPty(sessionId)
  }

  async probePtyLiveness(sessionId: string): Promise<boolean | null> {
    if (this.fallbackCollisions.has(sessionId)) {
      return null
    }
    const fallback = this.fallbackSessions.get(sessionId)
    if (!fallback) {
      return await this.routes.probeLiveness(sessionId)
    }
    return fallback.probePtyLiveness
      ? await fallback.probePtyLiveness(sessionId)
      : (fallback.hasPty?.(sessionId) ?? null)
  }

  shouldForwardStreamEvent(provider: IPtyProvider, sessionId: string): boolean {
    const adapter = this.daemonAdapter(provider)
    if (adapter) {
      const shouldForward = this.routes.recordDataOwner(sessionId, adapter)
      if (this.fallbackSessions.has(sessionId)) {
        this.fallbackCollisions.add(sessionId)
        return false
      }
      return shouldForward
    }
    const route = this.routes.get(sessionId)
    if (!route) {
      return (
        !this.fallbackSpawns.hasExited(sessionId) &&
        (this.fallbackSessions.get(sessionId) === provider ||
          this.fallbackSpawns.isInFlight(sessionId))
      )
    }
    if (
      this.fallbackSessions.get(sessionId) === provider &&
      route.state === 'unavailable' &&
      !this.fallbackCollisions.has(sessionId)
    ) {
      this.fallbackCollisions.delete(sessionId)
      return true
    }
    if (route) {
      this.fallbackCollisions.add(sessionId)
      return false
    }
    return true
  }

  recordExit(provider: IPtyProvider, sessionId: string): boolean {
    const adapter = this.daemonAdapter(provider)
    if (!adapter) {
      const isOwned =
        this.fallbackSessions.get(sessionId) === provider ||
        this.fallbackSpawns.isInFlight(sessionId)
      if (!isOwned) {
        return false
      }
      this.fallbackSpawns.recordExit(sessionId)
      this.fallbackSessions.delete(sessionId)
      this.fallbackCollisions.delete(sessionId)
      const route = this.routes.get(sessionId)
      return !route || route.state === 'unavailable'
    }
    this.snapshotAcks.dropForProducer(sessionId, adapter)
    if (this.fallbackSessions.has(sessionId)) {
      this.routes.markUnavailable(sessionId, adapter)
      if (this.routes.get(sessionId)?.state === 'unavailable') {
        this.fallbackCollisions.delete(sessionId)
      }
      return false
    }
    const shouldForward = this.routes.shouldForwardEvent(sessionId, adapter)
    this.routes.markUnavailable(sessionId, adapter)
    return shouldForward
  }

  recordShutdown(sessionId: string, provider: IPtyProvider, keepHistory?: boolean): void {
    if (keepHistory) {
      return
    }
    if (provider === this.fallback) {
      this.fallbackSessions.delete(sessionId)
      this.fallbackCollisions.delete(sessionId)
    } else {
      const adapter = provider as DaemonPtyAdapter
      this.routes.markUnavailable(sessionId, adapter)
      this.snapshotAcks.dropForProducer(sessionId, adapter)
    }
  }

  async reconcile(validWorktreeIds: Set<string>): Promise<{ alive: string[]; killed: string[] }> {
    const alive: string[] = []
    const killed: string[] = []
    const reconciled: {
      adapter: DaemonPtyAdapter
      incarnation: ReturnType<DaemonPtyAdapter['getLastAuthenticatedDaemonIdentity']>
      alive: string[]
      killed: string[]
    }[] = []
    for (const adapter of this.adapters) {
      const before = adapter.getLastAuthenticatedDaemonIdentity()
      const result = await adapter.reconcileOnStartup(validWorktreeIds)
      const incarnation = adapter.getLastAuthenticatedDaemonIdentity()
      if (before && !sameDaemonIncarnation(before, incarnation)) {
        this.routes.markOwnerUnavailable(adapter, before)
        throw new Error('daemon incarnation changed during startup reconciliation')
      }
      reconciled.push({ adapter, incarnation, ...result })
      for (const id of result.alive) {
        alive.push(id)
      }
      for (const id of result.killed) {
        killed.push(id)
      }
    }
    for (const { adapter, incarnation } of reconciled) {
      if (!sameDaemonIncarnation(incarnation, adapter.getLastAuthenticatedDaemonIdentity())) {
        this.routes.markOwnerUnavailable(adapter, incarnation)
        throw new Error('daemon incarnation changed during startup reconciliation')
      }
    }
    for (const { adapter, incarnation, alive: sessionIds } of reconciled) {
      for (const id of sessionIds) {
        this.routes.recordOwnedIncarnation(id, adapter, incarnation)
        if (this.fallbackSessions.has(id)) {
          this.fallbackCollisions.add(id)
        }
      }
    }
    for (const { adapter, incarnation, killed: sessionIds } of reconciled) {
      for (const id of sessionIds) {
        this.routes.markUnavailable(id, adapter, incarnation)
        this.snapshotAcks.dropForProducer(id, adapter, incarnation)
        if (this.routes.get(id)?.state === 'unavailable') {
          this.fallbackCollisions.delete(id)
        }
      }
    }
    return { alive, killed }
  }

  clearTombstone(sessionId: string): void {
    this.routes.getOwned(sessionId)?.clearTombstone(sessionId)
  }

  currentSessionIds(): string[] {
    return this.routes.getOwnedSessionIds(this.current)
  }

  recordCurrentSyntheticExits(): string[] {
    const forwarded: string[] = []
    for (const id of this.currentSessionIds()) {
      if (this.routes.shouldForwardEvent(id, this.current)) {
        forwarded.push(id)
      }
      this.routes.markUnavailable(id, this.current)
      this.snapshotAcks.dropForProducer(id, this.current)
      if (this.routes.get(id)?.state === 'unavailable') {
        this.fallbackCollisions.delete(id)
      }
    }
    return forwarded
  }

  async shutdownFallbackSessions(): Promise<number> {
    return await shutdownDegradedFallbackSessions(this.fallbackSessions, this.fallback)
  }

  allProviders(): IPtyProvider[] {
    return [this.fallback, ...this.adapters]
  }

  allAdapters(): readonly DaemonPtyAdapter[] {
    return this.adapters
  }

  dispose(): void {
    for (const unsubscribe of this.identityUnsubscribes.splice(0)) {
      unsubscribe()
    }
    this.fallbackSessions.clear()
    this.fallbackCollisions.clear()
    this.fallbackSpawns.clear()
    this.snapshotAcks.clear()
  }

  private async spawnTarget(opts: PtySpawnOptions): Promise<IPtyProvider> {
    if (opts.sessionId && this.fallbackCollisions.has(opts.sessionId)) {
      throw new DaemonSessionOwnerUnknownError(opts.sessionId)
    }
    if (!opts.sessionId || opts.isNewSession) {
      this.routes.assertFreshSpawnAvailable(opts.sessionId)
      return this.fallback
    }
    return (
      this.fallbackSessions.get(opts.sessionId) ?? (await this.routes.resolveOwner(opts.sessionId))
    )
  }

  private daemonAdapter(provider: IPtyProvider): DaemonPtyAdapter | null {
    return this.adapterSet.has(provider as DaemonPtyAdapter) ? (provider as DaemonPtyAdapter) : null
  }
}
