import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import {
  createOwnedDaemonSessionRoute,
  DaemonSessionGoneError,
  DaemonSessionOwnerUnknownError,
  type DaemonSessionRoute,
  DaemonSessionUnavailableError,
  sameDaemonIncarnation
} from './daemon-session-route'

export class DaemonSessionRouteTable {
  private readonly routes = new Map<string, DaemonSessionRoute>()
  private readonly incompleteDiscoveries = new Set<DaemonPtyAdapter>()

  constructor(private readonly adapters: readonly DaemonPtyAdapter[]) {}

  get(sessionId: string): DaemonSessionRoute | undefined {
    return this.routes.get(sessionId)
  }

  getOwned(sessionId: string): DaemonPtyAdapter | undefined {
    const route = this.routes.get(sessionId)
    return route?.state === 'owned' ? route.owner : undefined
  }

  shouldForwardEvent(sessionId: string, owner: DaemonPtyAdapter): boolean {
    const route = this.routes.get(sessionId)
    return !route || (route.state === 'owned' && route.owner === owner)
  }

  recordDataOwner(sessionId: string, owner: DaemonPtyAdapter): boolean {
    const route = this.routes.get(sessionId)
    if (!route) {
      this.routes.set(sessionId, createOwnedDaemonSessionRoute(owner))
      return true
    }
    if (route.state === 'unavailable') {
      this.recordOwned(sessionId, owner)
      return this.shouldForwardEvent(sessionId, owner)
    }
    if (route.state === 'ambiguous' || route.owner === owner) {
      return route.state === 'owned'
    }
    this.recordOwned(sessionId, owner)
    return false
  }

  recordOwned(sessionId: string, owner: DaemonPtyAdapter): void {
    const route = this.routes.get(sessionId)
    if (!route) {
      this.routes.set(sessionId, createOwnedDaemonSessionRoute(owner))
      return
    }
    if (route.state === 'owned' && route.owner === owner) {
      this.routes.set(sessionId, createOwnedDaemonSessionRoute(owner))
      return
    }
    if (route.state === 'unavailable') {
      const incarnation = owner.getLastAuthenticatedDaemonIdentity()
      if (route.owner !== owner || !sameDaemonIncarnation(route.incarnation, incarnation)) {
        this.routes.set(sessionId, createOwnedDaemonSessionRoute(owner))
      }
      return
    }
    const candidates =
      route.state === 'ambiguous' ? new Set(route.candidates) : new Set([route.owner])
    candidates.add(owner)
    this.routes.set(sessionId, { state: 'ambiguous', candidates })
  }

  transfer(sessionId: string, owner: DaemonPtyAdapter): void {
    this.routes.set(sessionId, createOwnedDaemonSessionRoute(owner))
  }

  recordFreshOwned(sessionId: string, owner: DaemonPtyAdapter): void {
    const route = this.routes.get(sessionId)
    if (route?.state === 'unavailable' && route.owner === owner) {
      this.transfer(sessionId, owner)
      return
    }
    this.recordOwned(sessionId, owner)
  }

  recordDiscoveryFailure(owner: DaemonPtyAdapter): void {
    this.incompleteDiscoveries.add(owner)
  }

  recordCompleteDiscovery(owner: DaemonPtyAdapter, sessionIds: readonly string[]): void {
    for (const sessionId of sessionIds) {
      this.recordOwned(sessionId, owner)
    }
    this.incompleteDiscoveries.delete(owner)
  }

  markUnavailable(sessionId: string, owner: DaemonPtyAdapter): void {
    const route = this.routes.get(sessionId)
    if (!route) {
      this.routes.set(sessionId, {
        state: 'unavailable',
        owner,
        incarnation: owner.getLastAuthenticatedDaemonIdentity()
      })
      return
    }
    if (route.state === 'owned' && route.owner === owner) {
      this.routes.set(sessionId, {
        state: 'unavailable',
        owner,
        incarnation: route.incarnation
      })
      return
    }
    if (route.state === 'ambiguous' && route.candidates.has(owner)) {
      const candidates = new Set(route.candidates)
      candidates.delete(owner)
      if (candidates.size === 1) {
        for (const candidate of candidates) {
          this.routes.set(sessionId, createOwnedDaemonSessionRoute(candidate))
        }
      } else if (candidates.size > 1) {
        this.routes.set(sessionId, { state: 'ambiguous', candidates })
      } else {
        this.routes.set(sessionId, {
          state: 'unavailable',
          owner,
          incarnation: owner.getLastAuthenticatedDaemonIdentity()
        })
      }
    }
  }

  markOwnerUnavailable(
    owner: DaemonPtyAdapter,
    incarnation = owner.getLastAuthenticatedDaemonIdentity()
  ): void {
    for (const [sessionId, route] of this.routes) {
      if (route.state === 'ambiguous' && route.candidates.has(owner)) {
        this.markUnavailable(sessionId, owner)
        continue
      }
      if (
        route.state === 'owned' &&
        route.owner === owner &&
        sameDaemonIncarnation(route.incarnation, incarnation)
      ) {
        this.routes.set(sessionId, {
          state: 'unavailable',
          owner,
          incarnation: route.incarnation
        })
      }
    }
  }

  ownerForFreshSpawn(sessionId: string | undefined, current: DaemonPtyAdapter): DaemonPtyAdapter {
    if (!sessionId) {
      return current
    }
    const route = this.routes.get(sessionId)
    if (!route) {
      return current
    }
    if (route.state === 'owned' && route.owner === current) {
      return current
    }
    if (route.state === 'unavailable') {
      const ownerIncarnation = route.owner.getLastAuthenticatedDaemonIdentity()
      if (
        route.incarnation &&
        ownerIncarnation &&
        !sameDaemonIncarnation(route.incarnation, ownerIncarnation)
      ) {
        this.routes.delete(sessionId)
        return current
      }
      throw new DaemonSessionUnavailableError(sessionId)
    }
    throw new DaemonSessionOwnerUnknownError(sessionId)
  }

  async resolveOwner(sessionId: string): Promise<DaemonPtyAdapter> {
    const route = this.routes.get(sessionId)
    if (route?.state === 'owned') {
      return route.owner
    }
    if (route?.state === 'unavailable') {
      throw new DaemonSessionUnavailableError(sessionId)
    }
    const candidates =
      route?.state === 'ambiguous' && this.incompleteDiscoveries.size === 0
        ? [...route.candidates]
        : this.adapters
    const results = await Promise.all(
      candidates.map(async (owner) => ({
        owner,
        result: await probeOwner(owner, sessionId)
      }))
    )
    const owners = results.filter(({ result }) => result === true).map(({ owner }) => owner)
    if (owners.length === 1 && results.every(({ result }) => result !== null)) {
      this.transfer(sessionId, owners[0])
      return owners[0]
    }
    if (owners.length > 1) {
      this.routes.set(sessionId, { state: 'ambiguous', candidates: new Set(owners) })
    }
    if (
      owners.length === 0 &&
      results.every(({ result }) => result === false) &&
      this.incompleteDiscoveries.size === 0
    ) {
      throw new DaemonSessionGoneError(sessionId)
    }
    throw new DaemonSessionOwnerUnknownError(sessionId)
  }

  async probeLiveness(sessionId: string): Promise<boolean | null> {
    const route = this.routes.get(sessionId)
    if (route?.state === 'unavailable' || route?.state === 'ambiguous') {
      return null
    }
    if (route?.state === 'owned') {
      return await probeOwner(route.owner, sessionId)
    }
    try {
      await this.resolveOwner(sessionId)
      return true
    } catch (error) {
      return error instanceof DaemonSessionGoneError ? false : null
    }
  }

  resolveOwnerSync(sessionId: string): DaemonPtyAdapter {
    const route = this.routes.get(sessionId)
    if (route?.state === 'owned') {
      return route.owner
    }
    if (route?.state === 'unavailable') {
      throw new DaemonSessionUnavailableError(sessionId)
    }
    if (route?.state === 'ambiguous' || this.incompleteDiscoveries.size > 0) {
      throw new DaemonSessionOwnerUnknownError(sessionId)
    }
    const results = this.adapters.map((owner) => ({
      owner,
      result: hasPty(owner, sessionId)
    }))
    const owners = results.filter(({ result }) => result === true).map(({ owner }) => owner)
    if (results.some(({ result }) => result === null)) {
      throw new DaemonSessionOwnerUnknownError(sessionId)
    }
    if (owners.length === 1) {
      this.transfer(sessionId, owners[0])
      return owners[0]
    }
    if (owners.length > 1) {
      this.routes.set(sessionId, { state: 'ambiguous', candidates: new Set(owners) })
      throw new DaemonSessionOwnerUnknownError(sessionId)
    }
    throw new DaemonSessionGoneError(sessionId)
  }
}

async function probeOwner(owner: DaemonPtyAdapter, sessionId: string): Promise<boolean | null> {
  try {
    return await owner.probePtyLiveness(sessionId)
  } catch {
    return null
  }
}

function hasPty(owner: DaemonPtyAdapter, sessionId: string): boolean | null {
  try {
    return owner.hasPty(sessionId)
  } catch {
    return null
  }
}
