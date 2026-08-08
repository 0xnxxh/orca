import {
  assertAuthorityId,
  assertAuthorityNamespace,
  isRecord,
  type TerminalAuthorityNamespace
} from './terminal-session-authority-identity'
import {
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
  isAuthorityId,
  parseTerminalAuthorityPolicyConsumerClaim,
  parseTerminalAuthorityPolicyConsumerIdentity,
  sameTerminalAuthorityPolicyConsumer,
  type TerminalAuthorityPolicyConsumerClaim,
  type TerminalAuthorityPolicyConsumerIdentity
} from './terminal-session-authority-consumer-identity'
import type {
  TerminalAuthorityDurableOutcome,
  TerminalAuthorityProjection
} from './terminal-session-authority-mutation'
import { parseTerminalAuthorityDurableOutcome } from './terminal-authority-durable-outcome-validation'
import {
  parseTerminalAuthorityBoundaryProjection,
  terminalAuthorityOutcomeMatchesNamespace
} from './terminal-session-authority-boundary-projection-validation'
import { parseTerminalAuthorityOutcomePage } from './terminal-session-authority-outcome-page-validation'

export const TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_CAPABILITY =
  'terminal-session.authority-namespace-outcomes.v1'
export const TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_NOTIFICATION =
  'terminalAuthority.namespaceOutcomeBoundary'
export const TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_NOTIFICATION =
  'terminalAuthority.namespaceOutcome'
export const TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_ACK_METHOD =
  'terminalAuthority.ackNamespaceOutcome'
export const TERMINAL_AUTHORITY_NAMESPACE_BOUNDARY_ACCEPT_METHOD =
  'terminalAuthority.acceptNamespaceOutcomeBoundary'
export const TERMINAL_AUTHORITY_POLICY_CONSUMER_RETIRE_METHOD =
  'terminalAuthority.retirePolicyConsumer'

export {
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
  parseTerminalAuthorityPolicyConsumerClaim,
  parseTerminalAuthorityPolicyConsumerIdentity,
  sameTerminalAuthorityPolicyConsumer
}
export type { TerminalAuthorityPolicyConsumerClaim, TerminalAuthorityPolicyConsumerIdentity }

export type TerminalAuthorityNamespaceOutcomeBoundary = Readonly<{
  version: typeof TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION
  consumer: TerminalAuthorityPolicyConsumerIdentity
  namespace: TerminalAuthorityNamespace
  acknowledgedSequence: number
  outcomeHighWatermark: number
  /** Required by authoritative consumers; optional only for structural old-peer parsing. */
  boundaryId?: string
  /** Optional on the wire; authoritative app initialization requires host attestation. */
  consumerStart?: 'new-at-tail' | 'resume'
  /** Optional for mixed versions; app consumers require it before ACKing. */
  projection?: TerminalAuthorityProjection
}>

export type TerminalAuthorityNamespaceBoundaryAcceptance = Readonly<{
  version: typeof TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION
  consumer: TerminalAuthorityPolicyConsumerIdentity
  namespace: TerminalAuthorityNamespace
  boundaryId: string
  acknowledgedSequence: number
  outcomeHighWatermark: number
}>

export type TerminalAuthorityNamespaceOutcomePublication = Readonly<{
  version: typeof TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION
  consumer: TerminalAuthorityPolicyConsumerIdentity
  namespace: TerminalAuthorityNamespace
  previousSequence: number
  outcome: TerminalAuthorityDurableOutcome
  /** Optional bounded page; omission represents the required one-entry page. */
  outcomes?: readonly TerminalAuthorityDurableOutcome[]
}>

export type TerminalAuthorityNamespaceOutcomeAck = Readonly<{
  version: typeof TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION
  consumer: TerminalAuthorityPolicyConsumerIdentity
  namespace: TerminalAuthorityNamespace
  sequence: number
  outcomeId: string
}>

export type TerminalAuthorityPolicyConsumerRetirement = Readonly<{
  version: typeof TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION
  consumer: TerminalAuthorityPolicyConsumerIdentity
}>

export function parseTerminalAuthorityNamespaceOutcomeBoundary(
  value: unknown
): TerminalAuthorityNamespaceOutcomeBoundary | null {
  if (!isVersionedRecord(value)) {
    return null
  }
  const consumer = parseTerminalAuthorityPolicyConsumerIdentity(value.consumer)
  try {
    assertAuthorityNamespace(value.namespace)
  } catch {
    return null
  }
  if (
    !consumer ||
    (value.consumerStart !== undefined &&
      value.consumerStart !== 'new-at-tail' &&
      value.consumerStart !== 'resume') ||
    !isSequence(value.acknowledgedSequence, true) ||
    !isSequence(value.outcomeHighWatermark, true) ||
    Number(value.acknowledgedSequence) > Number(value.outcomeHighWatermark) ||
    (value.consumerStart === 'new-at-tail' &&
      value.acknowledgedSequence !== value.outcomeHighWatermark) ||
    (value.boundaryId !== undefined && !isAuthorityId(value.boundaryId, 'boundaryId'))
  ) {
    return null
  }
  const namespace = Object.freeze({ ...value.namespace })
  const projection =
    value.projection === undefined
      ? undefined
      : parseTerminalAuthorityBoundaryProjection(
          value.projection,
          namespace,
          Number(value.outcomeHighWatermark)
        )
  if (value.projection !== undefined && !projection) {
    return null
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
    consumer,
    namespace,
    acknowledgedSequence: Number(value.acknowledgedSequence),
    outcomeHighWatermark: Number(value.outcomeHighWatermark),
    ...(typeof value.boundaryId === 'string' ? { boundaryId: value.boundaryId } : {}),
    ...(value.consumerStart ? { consumerStart: value.consumerStart } : {}),
    ...(projection ? { projection } : {})
  })
}

export function parseTerminalAuthorityNamespaceBoundaryAcceptance(
  value: unknown
): TerminalAuthorityNamespaceBoundaryAcceptance | null {
  if (!isVersionedRecord(value)) {
    return null
  }
  const consumer = parseTerminalAuthorityPolicyConsumerIdentity(value.consumer)
  try {
    assertAuthorityNamespace(value.namespace)
    assertAuthorityId(value.boundaryId, 'boundaryId')
  } catch {
    return null
  }
  if (
    !consumer ||
    !isSequence(value.acknowledgedSequence, true) ||
    !isSequence(value.outcomeHighWatermark, true) ||
    Number(value.acknowledgedSequence) > Number(value.outcomeHighWatermark)
  ) {
    return null
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
    consumer,
    namespace: Object.freeze({ ...value.namespace }),
    boundaryId: value.boundaryId,
    acknowledgedSequence: Number(value.acknowledgedSequence),
    outcomeHighWatermark: Number(value.outcomeHighWatermark)
  })
}

export function parseTerminalAuthorityNamespaceOutcomePublication(
  value: unknown
): TerminalAuthorityNamespaceOutcomePublication | null {
  if (!isVersionedRecord(value)) {
    return null
  }
  const consumer = parseTerminalAuthorityPolicyConsumerIdentity(value.consumer)
  const outcome = parseTerminalAuthorityDurableOutcome(value.outcome)
  try {
    assertAuthorityNamespace(value.namespace)
  } catch {
    return null
  }
  if (
    !consumer ||
    !outcome ||
    !isSequence(value.previousSequence, true) ||
    outcome.sequence !== Number(value.previousSequence) + 1 ||
    !terminalAuthorityOutcomeMatchesNamespace(outcome, value.namespace)
  ) {
    return null
  }
  const outcomes =
    value.outcomes === undefined
      ? null
      : parseTerminalAuthorityOutcomePage(value.outcomes, outcome, value.namespace)
  if (value.outcomes !== undefined && !outcomes) {
    return null
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
    consumer,
    namespace: Object.freeze({ ...value.namespace }),
    previousSequence: Number(value.previousSequence),
    outcome,
    ...(outcomes ? { outcomes } : {})
  })
}

export function parseTerminalAuthorityNamespaceOutcomeAck(
  value: unknown
): TerminalAuthorityNamespaceOutcomeAck | null {
  if (!isVersionedRecord(value)) {
    return null
  }
  const consumer = parseTerminalAuthorityPolicyConsumerIdentity(value.consumer)
  try {
    assertAuthorityNamespace(value.namespace)
    assertAuthorityId(value.outcomeId, 'outcomeId')
  } catch {
    return null
  }
  if (!consumer || !isSequence(value.sequence, false)) {
    return null
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
    consumer,
    namespace: Object.freeze({ ...value.namespace }),
    sequence: Number(value.sequence),
    outcomeId: value.outcomeId
  })
}

export function parseTerminalAuthorityPolicyConsumerRetirement(
  value: unknown
): TerminalAuthorityPolicyConsumerRetirement | null {
  if (!isVersionedRecord(value)) {
    return null
  }
  const consumer = parseTerminalAuthorityPolicyConsumerIdentity(value.consumer)
  return consumer
    ? Object.freeze({ version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION, consumer })
    : null
}

function isVersionedRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.version === TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION
}

function isSequence(value: unknown, allowZero: boolean): value is number {
  return Number.isSafeInteger(value) && Number(value) >= (allowZero ? 0 : 1)
}
