import type { IPtyProvider } from '../providers/types'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import { sameDaemonIncarnation } from './daemon-session-route'
import type { DaemonSessionRouteTable } from './daemon-session-route-table'

type FallbackLivenessProbe = {
  provider: IPtyProvider
  epoch: symbol
  daemonRoute: ReturnType<DaemonSessionRouteTable['get']>
}

export class DegradedFallbackSessionRoutes {
  private readonly collisionIds = new Set<string>()
  private readonly epochs = new Map<string, symbol>()

  constructor(
    private readonly sessions: Map<string, IPtyProvider>,
    private readonly daemonRoutes: DaemonSessionRouteTable
  ) {}

  hasCollision(sessionId: string): boolean {
    return this.collisionIds.has(sessionId)
  }

  recordCollision(sessionId: string): void {
    this.collisionIds.add(sessionId)
  }

  clearCollision(sessionId: string): void {
    this.collisionIds.delete(sessionId)
  }

  recordSpawnedSession(sessionId: string, provider: IPtyProvider): void {
    this.sessions.set(sessionId, provider)
    this.epochs.set(sessionId, Symbol())
    const daemonRoute = this.daemonRoutes.get(sessionId)
    if (daemonRoute?.state === 'unavailable') {
      this.clearCollision(sessionId)
    } else if (daemonRoute) {
      this.recordCollision(sessionId)
    }
  }

  clearUnownedCollision(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      this.clearCollision(sessionId)
    }
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.epochs.delete(sessionId)
    this.collisionIds.delete(sessionId)
  }

  captureLivenessProbe(sessionId: string): FallbackLivenessProbe | null {
    const provider = this.sessions.get(sessionId)
    const epoch = this.epochs.get(sessionId)
    if (!provider || !epoch || this.collisionIds.has(sessionId)) {
      return null
    }
    return { provider, epoch, daemonRoute: this.daemonRoutes.get(sessionId) }
  }

  acceptsLivenessResult(sessionId: string, probe: FallbackLivenessProbe): boolean {
    return (
      this.sessions.get(sessionId) === probe.provider &&
      this.epochs.get(sessionId) === probe.epoch &&
      this.daemonRoutes.get(sessionId) === probe.daemonRoute &&
      !this.collisionIds.has(sessionId)
    )
  }

  pruneSessionEpochs(): void {
    for (const sessionId of this.epochs.keys()) {
      if (!this.sessions.has(sessionId)) {
        this.epochs.delete(sessionId)
        this.collisionIds.delete(sessionId)
      }
    }
  }

  clear(): void {
    this.sessions.clear()
    this.epochs.clear()
    this.collisionIds.clear()
  }

  markDaemonOwnerUnavailable(
    owner: DaemonPtyAdapter,
    incarnation: ReturnType<DaemonPtyAdapter['getLastAuthenticatedDaemonIdentity']>
  ): void {
    const invalidated = [...this.collisionIds].filter((sessionId) =>
      this.isCollisionOwnedBy(sessionId, owner, incarnation)
    )
    this.daemonRoutes.markOwnerUnavailable(owner, incarnation)
    for (const sessionId of invalidated) {
      if (this.daemonRoutes.get(sessionId)?.state === 'unavailable') {
        this.collisionIds.delete(sessionId)
      }
    }
  }

  private isCollisionOwnedBy(
    sessionId: string,
    owner: DaemonPtyAdapter,
    incarnation: ReturnType<DaemonPtyAdapter['getLastAuthenticatedDaemonIdentity']>
  ): boolean {
    if (!this.sessions.has(sessionId)) {
      return false
    }
    const route = this.daemonRoutes.get(sessionId)
    if (route?.state === 'owned') {
      return route.owner === owner && sameDaemonIncarnation(route.incarnation, incarnation)
    }
    return (
      route?.state === 'ambiguous' &&
      route.candidates.has(owner) &&
      sameDaemonIncarnation(route.candidates.get(owner) ?? null, incarnation)
    )
  }
}
