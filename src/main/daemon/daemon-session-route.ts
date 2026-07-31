import { DAEMON_SESSION_ROUTING_UNAVAILABLE_MARKER } from '../../shared/daemon-session-routing-error'
import type { DaemonEndpointIdentity } from './daemon-hello-protocol'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'

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

export function createOwnedDaemonSessionRoute(
  owner: DaemonPtyAdapter
): Extract<DaemonSessionRoute, { state: 'owned' }> {
  return {
    state: 'owned',
    owner,
    incarnation: owner.getLastAuthenticatedDaemonIdentity()
  }
}

export function sameDaemonIncarnation(
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
