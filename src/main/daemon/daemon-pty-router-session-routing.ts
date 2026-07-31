import type { PtyProviderBufferSnapshot, PtySpawnOptions, PtySpawnResult } from '../providers/types'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type { DaemonEndpointIdentity } from './daemon-hello-protocol'
import { DaemonSessionRouteTable } from './daemon-session-route-table'
import { DaemonSnapshotAcknowledgementRoutes } from './daemon-snapshot-acknowledgement-routes'

export class DaemonPtyRouterSessionRouting {
  private readonly routes: DaemonSessionRouteTable
  private readonly snapshotAcks = new DaemonSnapshotAcknowledgementRoutes()
  private readonly freshSpawnsInFlight = new Map<
    string,
    { owner: DaemonPtyAdapter; count: number }
  >()
  private readonly identityUnsubscribes: (() => void)[] = []

  constructor(
    private readonly current: DaemonPtyAdapter,
    private readonly adapters: readonly DaemonPtyAdapter[]
  ) {
    this.routes = new DaemonSessionRouteTable(adapters)
    for (const adapter of adapters) {
      this.identityUnsubscribes.push(
        adapter.onDaemonIdentityChanged(({ previous }) => {
          this.snapshotAcks.dropAdapterIncarnation(adapter, previous)
          this.routes.markOwnerUnavailable(adapter, previous)
        })
      )
    }
  }

  recordDiscovery(
    adapter: DaemonPtyAdapter,
    sessions: readonly { id: string }[],
    incarnation?: DaemonEndpointIdentity | null
  ): void {
    this.routes.recordCompleteDiscovery(
      adapter,
      sessions.map((session) => session.id),
      incarnation
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

  beginSpawn(opts: PtySpawnOptions, target: DaemonPtyAdapter): void {
    if (!opts.isNewSession || !opts.sessionId) {
      return
    }
    const inFlight = this.freshSpawnsInFlight.get(opts.sessionId)
    this.freshSpawnsInFlight.set(opts.sessionId, {
      owner: target,
      count: (inFlight?.count ?? 0) + 1
    })
  }

  endSpawn(opts: PtySpawnOptions): void {
    if (!opts.isNewSession || !opts.sessionId) {
      return
    }
    const inFlight = this.freshSpawnsInFlight.get(opts.sessionId)
    if (!inFlight || inFlight.count <= 1) {
      this.freshSpawnsInFlight.delete(opts.sessionId)
      return
    }
    this.freshSpawnsInFlight.set(opts.sessionId, {
      owner: inFlight.owner,
      count: inFlight.count - 1
    })
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
    return this.routes.hasPty(sessionId)
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
    return await this.snapshotAcks.capture(sessionId, opts, owner, this.adapters)
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
      this.snapshotAcks.dropForProducer(sessionId, owner)
    }
  }

  recordReconciledAlive(
    sessionId: string,
    owner: DaemonPtyAdapter,
    incarnation?: DaemonEndpointIdentity | null
  ): void {
    this.routes.recordOwnedIncarnation(
      sessionId,
      owner,
      incarnation ?? owner.getLastAuthenticatedDaemonIdentity()
    )
  }

  recordReconciledKilled(
    sessionId: string,
    owner: DaemonPtyAdapter,
    incarnation?: DaemonEndpointIdentity | null
  ): void {
    this.routes.markUnavailable(
      sessionId,
      owner,
      incarnation ?? owner.getLastAuthenticatedDaemonIdentity()
    )
    this.snapshotAcks.dropForProducer(
      sessionId,
      owner,
      incarnation ?? owner.getLastAuthenticatedDaemonIdentity()
    )
  }

  shouldForwardEvent(sessionId: string, owner: DaemonPtyAdapter): boolean {
    return this.routes.shouldForwardEvent(sessionId, owner)
  }

  shouldForwardStreamEvent(sessionId: string, owner: DaemonPtyAdapter): boolean {
    const freshSpawn = this.freshSpawnsInFlight.get(sessionId)
    if (freshSpawn && freshSpawn.owner !== owner) {
      this.routes.recordFreshOwned(sessionId, freshSpawn.owner)
      this.routes.recordOwned(sessionId, owner)
      return false
    }
    return this.routes.recordDataOwner(sessionId, owner)
  }

  recordExit(sessionId: string, owner: DaemonPtyAdapter): boolean {
    const freshSpawn = this.freshSpawnsInFlight.get(sessionId)
    if (freshSpawn && freshSpawn.owner !== owner) {
      if (this.routes.get(sessionId)) {
        this.routes.markUnavailable(sessionId, owner)
      }
      this.snapshotAcks.dropForProducer(sessionId, owner)
      return false
    }
    const shouldForward = this.shouldForwardEvent(sessionId, owner)
    this.routes.markUnavailable(sessionId, owner)
    this.snapshotAcks.dropForProducer(sessionId, owner)
    return shouldForward
  }

  markAdapterUnavailable(
    adapter: DaemonPtyAdapter,
    incarnation = adapter.getLastAuthenticatedDaemonIdentity()
  ): void {
    if (this.adapters.includes(adapter)) {
      this.routes.markOwnerUnavailable(adapter, incarnation)
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
    this.freshSpawnsInFlight.clear()
    this.snapshotAcks.clear()
  }
}
