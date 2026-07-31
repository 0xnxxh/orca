import type { PtyProviderBufferSnapshot, PtySpawnOptions, PtySpawnResult } from '../providers/types'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import { DaemonSessionRouteTable } from './daemon-session-route-table'
import { DaemonSnapshotAcknowledgementRoutes } from './daemon-snapshot-acknowledgement-routes'

export class DaemonPtyRouterSessionRouting {
  private readonly routes: DaemonSessionRouteTable
  private readonly snapshotAcks = new DaemonSnapshotAcknowledgementRoutes()
  private readonly identityUnsubscribes: (() => void)[] = []

  constructor(
    private readonly current: DaemonPtyAdapter,
    private readonly adapters: readonly DaemonPtyAdapter[]
  ) {
    this.routes = new DaemonSessionRouteTable(adapters)
    for (const adapter of adapters) {
      this.identityUnsubscribes.push(
        adapter.onDaemonIdentityChanged(({ previous }) => {
          this.routes.markOwnerUnavailable(adapter, previous)
        })
      )
    }
  }

  recordDiscovery(adapter: DaemonPtyAdapter, sessions: readonly { id: string }[]): void {
    this.routes.recordCompleteDiscovery(
      adapter,
      sessions.map((session) => session.id)
    )
  }

  recordDiscoveryFailure(adapter: DaemonPtyAdapter): void {
    this.routes.recordDiscoveryFailure(adapter)
  }

  spawnTarget(opts: PtySpawnOptions): DaemonPtyAdapter | Promise<DaemonPtyAdapter> {
    if (!opts.sessionId || opts.isNewSession) {
      return this.routes.ownerForFreshSpawn(opts.sessionId, this.current)
    }
    return this.routes.resolveOwner(opts.sessionId)
  }

  recordSpawn(result: PtySpawnResult, target: DaemonPtyAdapter, opts: PtySpawnOptions): void {
    if (result.exitedBeforeSpawnReply) {
      return
    }
    if (opts.isNewSession && opts.sessionId === result.id) {
      this.routes.recordFreshOwned(result.id, target)
      return
    }
    this.routes.recordOwned(result.id, target)
  }

  async owner(sessionId: string): Promise<DaemonPtyAdapter> {
    return await this.routes.resolveOwner(sessionId)
  }

  ownerSync(sessionId: string): DaemonPtyAdapter {
    return this.routes.resolveOwnerSync(sessionId)
  }

  ownerForHint(sessionId: string): DaemonPtyAdapter | null {
    try {
      return this.ownerSync(sessionId)
    } catch {
      return null
    }
  }

  ownerOrCurrent(sessionId?: string): DaemonPtyAdapter {
    return sessionId ? this.ownerSync(sessionId) : this.current
  }

  hasPty(sessionId: string): boolean {
    const route = this.routes.get(sessionId)
    if (route?.state === 'unavailable') {
      return false
    }
    if (route?.state === 'owned') {
      return route.owner.hasPty(sessionId)
    }
    return this.adapters.some((adapter) => adapter.hasPty(sessionId))
  }

  async probePtyLiveness(sessionId: string): Promise<boolean | null> {
    return await this.routes.probeLiveness(sessionId)
  }

  providesAgentSessionOwnerListings(sessionId: string): boolean {
    return this.routes.getOwned(sessionId)?.providesAgentSessionOwnerListings(sessionId) === true
  }

  canProvideAuthoritativeBufferSnapshot(sessionId: string): boolean {
    return this.ownerSync(sessionId).canProvideAuthoritativeBufferSnapshot(sessionId)
  }

  async getBufferSnapshot(
    sessionId: string,
    opts?: { scrollbackRows?: number }
  ): Promise<PtyProviderBufferSnapshot | null> {
    const owner = await this.owner(sessionId)
    const snapshot = await owner.getBufferSnapshot(sessionId, opts)
    this.snapshotAcks.record(sessionId, snapshot, owner)
    return snapshot
  }

  acknowledgeBufferSnapshot(sessionId: string): void {
    this.snapshotAcks.acknowledge(sessionId)
  }

  recordShutdown(
    sessionId: string,
    owner: DaemonPtyAdapter,
    keepHistory: boolean | undefined,
    migrateHistory: boolean
  ): void {
    if (migrateHistory) {
      this.routes.transfer(sessionId, this.current)
      return
    }
    if (!keepHistory) {
      this.routes.markUnavailable(sessionId, owner)
      this.snapshotAcks.drop(sessionId)
    }
  }

  recordReconciledAlive(sessionId: string, owner: DaemonPtyAdapter): void {
    this.routes.recordOwned(sessionId, owner)
  }

  recordReconciledKilled(sessionId: string, owner: DaemonPtyAdapter): void {
    this.routes.markUnavailable(sessionId, owner)
    this.snapshotAcks.drop(sessionId)
  }

  shouldForwardEvent(sessionId: string, owner: DaemonPtyAdapter): boolean {
    return this.routes.shouldForwardEvent(sessionId, owner)
  }

  shouldForwardStreamEvent(sessionId: string, owner: DaemonPtyAdapter): boolean {
    return this.routes.recordDataOwner(sessionId, owner)
  }

  recordExit(sessionId: string, owner: DaemonPtyAdapter): boolean {
    const shouldForward = this.shouldForwardEvent(sessionId, owner)
    this.routes.markUnavailable(sessionId, owner)
    return shouldForward
  }

  markAdapterUnavailable(adapter: DaemonPtyAdapter): void {
    if (this.adapters.includes(adapter)) {
      this.routes.markOwnerUnavailable(adapter)
    }
  }

  getRouteState(sessionId: string): 'owned' | 'unavailable' | 'ambiguous' | null {
    return this.routes.get(sessionId)?.state ?? null
  }

  clearAdapterTombstone(sessionId: string): void {
    this.routes.getOwned(sessionId)?.clearTombstone(sessionId)
  }

  dispose(): void {
    for (const unsubscribe of this.identityUnsubscribes.splice(0)) {
      unsubscribe()
    }
  }
}
