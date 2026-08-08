import { terminalSessionAuthorityBoundaryId } from '../../shared/terminal-session-authority-boundary-identity'
import {
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
  type TerminalAuthorityNamespaceOutcomeBoundary,
  type TerminalAuthorityPolicyConsumerIdentity
} from '../../shared/terminal-session-authority-consumer-transport'
import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'

export type TerminalAuthorityPolicyConsumerClaimPlan = Readonly<{
  expectedIncarnationId: string | null
  consumerStart: 'new-at-tail' | 'resume'
}>

export function prepareTerminalAuthorityPolicyConsumerClaim(
  service: TerminalSessionAuthorityService,
  identity: TerminalAuthorityPolicyConsumerIdentity,
  claimedExpectedIncarnationId: string | null
): TerminalAuthorityPolicyConsumerClaimPlan {
  const currentIncarnationId = service.activeConsumerIncarnation(
    service.writerAccess,
    identity.consumerId
  )
  if (
    currentIncarnationId !== null &&
    currentIncarnationId !== identity.consumerIncarnationId &&
    currentIncarnationId !== claimedExpectedIncarnationId
  ) {
    failTerminalSessionAuthority('consumer-conflict', 'consumer incarnation changed')
  }
  return Object.freeze({
    expectedIncarnationId: currentIncarnationId,
    consumerStart: currentIncarnationId === null ? 'new-at-tail' : 'resume'
  })
}

export function terminalAuthorityPolicyConsumerClaim(
  identity: TerminalAuthorityPolicyConsumerIdentity,
  expectedIncarnationId: string | null
): Readonly<{
  consumerId: string
  expectedIncarnationId: string | null
  consumerIncarnationId: string
}> {
  return Object.freeze({
    consumerId: identity.consumerId,
    expectedIncarnationId,
    consumerIncarnationId: identity.consumerIncarnationId
  })
}

export function terminalAuthorityPolicyConsumerBoundary(
  consumer: TerminalAuthorityPolicyConsumerIdentity,
  consumerStart: 'new-at-tail' | 'resume',
  snapshot: Awaited<ReturnType<TerminalSessionAuthorityService['snapshotForConsumer']>>
): TerminalAuthorityNamespaceOutcomeBoundary {
  const boundary = {
    version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
    consumer,
    namespace: Object.freeze({ ...snapshot.authority.namespace }),
    acknowledgedSequence: snapshot.acknowledgedSequence,
    outcomeHighWatermark: snapshot.outcomeHighWatermark,
    consumerStart,
    projection: structuredClone(snapshot.authority)
  }
  return Object.freeze({ ...boundary, boundaryId: terminalSessionAuthorityBoundaryId(boundary) })
}
