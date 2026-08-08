import { isDeepStrictEqual } from 'node:util'
import type {
  TerminalLegacyEndpointIdentity,
  TerminalLegacyProcessIdentity,
  TerminalLegacyWorkerRoute
} from '../../shared/terminal-legacy-cutover'
import { assertAuthorityId, isRecord } from '../../shared/terminal-session-authority-identity'
import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'

export type TerminalLegacyWorkerLiveRegistration = Readonly<{
  registrationId: string
  routeId: string
  workerId: string
  ownerIncarnationId: string
  buildId: string
  brokerConnectionIdentity: string
  process: TerminalLegacyProcessIdentity
  endpoint: TerminalLegacyEndpointIdentity
}>

export function assertTerminalLegacyWorkerLiveRegistration(
  value: unknown
): asserts value is TerminalLegacyWorkerLiveRegistration {
  if (!isRecord(value) || !isRecord(value.process) || !isRecord(value.endpoint)) {
    failTerminalSessionAuthority('expectation-mismatch', 'legacy live-worker proof is invalid')
  }
  for (const [field, selected] of [
    ['registrationId', value.registrationId],
    ['routeId', value.routeId],
    ['workerId', value.workerId],
    ['ownerIncarnationId', value.ownerIncarnationId],
    ['buildId', value.buildId],
    ['brokerConnectionIdentity', value.brokerConnectionIdentity]
  ] as const) {
    assertAuthorityId(selected, `legacy live-worker ${field}`)
  }
}

export function assertTerminalLegacyWorkerMatchesRoute(
  registration: TerminalLegacyWorkerLiveRegistration,
  route: TerminalLegacyWorkerRoute | null
): asserts route is TerminalLegacyWorkerRoute {
  if (
    !route ||
    registration.routeId !== route.routeId ||
    registration.workerId !== route.workerId ||
    registration.ownerIncarnationId !== route.ownerIncarnationId ||
    registration.buildId !== route.buildId ||
    !isDeepStrictEqual(registration.process, route.process) ||
    !isDeepStrictEqual(registration.endpoint, route.endpoint)
  ) {
    failTerminalSessionAuthority(
      'expectation-mismatch',
      'legacy live-worker proof does not match the authority route'
    )
  }
}
