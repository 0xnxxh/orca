import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import {
  DaemonSessionOwnerUnknownError,
  type DaemonSessionRoute,
  DaemonSessionUnavailableError,
  sameDaemonIncarnation
} from './daemon-session-route'

export function ownerForFreshDaemonSession(
  sessionId: string | undefined,
  route: DaemonSessionRoute | undefined,
  current: DaemonPtyAdapter,
  clearRoute: () => void
): DaemonPtyAdapter {
  if (!sessionId || !route) {
    return current
  }
  if (route.state === 'owned' && route.owner === current) {
    return current
  }
  assertFreshDaemonSessionAvailable(sessionId, route, clearRoute)
  return current
}

export function assertFreshDaemonSessionAvailable(
  sessionId: string | undefined,
  route: DaemonSessionRoute | undefined,
  clearRoute: () => void
): void {
  if (!sessionId || !route) {
    return
  }
  if (route.state === 'unavailable') {
    const ownerIncarnation = route.owner.getLastAuthenticatedDaemonIdentity()
    if (
      route.incarnation &&
      ownerIncarnation &&
      !sameDaemonIncarnation(route.incarnation, ownerIncarnation)
    ) {
      clearRoute()
      return
    }
    throw new DaemonSessionUnavailableError(sessionId)
  }
  throw new DaemonSessionOwnerUnknownError(sessionId)
}
