import type { DaemonEndpointIdentity } from './daemon-hello-protocol'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import { DAEMON_SESSION_ROUTING_UNAVAILABLE_MARKER } from '../../shared/daemon-session-routing-error'

export type DaemonSessionRoute =
  | {
      state: 'owned'
      owner: DaemonPtyAdapter
      incarnation: DaemonEndpointIdentity | null
    }
  | {
      state: 'unavailable'
      owner: DaemonPtyAdapter
      incarnation: DaemonEndpointIdentity | null
    }
  | {
      state: 'ambiguous'
      candidates: ReadonlySet<DaemonPtyAdapter>
    }

export class DaemonSessionOwnerUnknownError extends Error {
  constructor(sessionId: string) {
    super(`${DAEMON_SESSION_ROUTING_UNAVAILABLE_MARKER}: owner unknown for "${sessionId}"`)
    this.name = 'DaemonSessionOwnerUnknownError'
  }
}

export class DaemonSessionUnavailableError extends Error {
  constructor(sessionId: string) {
    super(`${DAEMON_SESSION_ROUTING_UNAVAILABLE_MARKER}: route unavailable for "${sessionId}"`)
    this.name = 'DaemonSessionUnavailableError'
  }
}

export class DaemonSessionGoneError extends Error {
  constructor(sessionId: string) {
    super(`terminal_gone: no daemon owns "${sessionId}"`)
    this.name = 'DaemonSessionGoneError'
  }
}

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

  recordOwned(sessionId: string, owner: DaemonPtyAdapter): void {
    const route = this.routes.get(sessionId)
    if (!route) {
      this.routes.set(sessionId, ownedRoute(owner))
      return
    }
    if (route.state === 'owned' && route.owner === owner) {
      this.routes.set(sessionId, ownedRoute(owner))
      return
    }
    if (route.state === 'unavailable') {
      const incarnation = owner.getLastAuthenticatedDaemonIdentity()
      if (route.owner === owner && !sameIncarnation(route.incarnation, incarnation)) {
        this.routes.set(sessionId, ownedRoute(owner))
      }
      return
    }
    const candidates =
      route.state === 'ambiguous' ? new Set(route.candidates) : new Set([route.owner])
    candidates.add(owner)
    this.routes.set(sessionId, { state: 'ambiguous', candidates })
  }

  transfer(sessionId: string, owner: DaemonPtyAdapter): void {
    this.routes.set(sessionId, ownedRoute(owner))
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
      this.routes.set(sessionId, {
        state: 'unavailable',
        owner,
        incarnation: owner.getLastAuthenticatedDaemonIdentity()
      })
    }
  }

  markOwnerUnavailable(
    owner: DaemonPtyAdapter,
    incarnation = owner.getLastAuthenticatedDaemonIdentity()
  ): void {
    for (const [sessionId, route] of this.routes) {
      if (
        route.state === 'owned' &&
        route.owner === owner &&
        sameIncarnation(route.incarnation, incarnation)
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
    if ((!route || route.state === 'ambiguous') && this.incompleteDiscoveries.size > 0) {
      throw new DaemonSessionOwnerUnknownError(sessionId)
    }
    const candidates = route?.state === 'ambiguous' ? [...route.candidates] : this.adapters
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

function ownedRoute(owner: DaemonPtyAdapter): Extract<DaemonSessionRoute, { state: 'owned' }> {
  return {
    state: 'owned',
    owner,
    incarnation: owner.getLastAuthenticatedDaemonIdentity()
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

function sameIncarnation(
  left: DaemonEndpointIdentity | null,
  right: DaemonEndpointIdentity | null
): boolean {
  if (!left || !right) {
    return left === right
  }
  return (
    left.pid === right.pid &&
    left.startedAtMs === right.startedAtMs &&
    left.launchNonce === right.launchNonce
  )
}
