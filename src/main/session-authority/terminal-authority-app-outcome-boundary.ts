import {
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
  parseTerminalAuthorityNamespaceOutcomeBoundary,
  type TerminalAuthorityNamespaceBoundaryAcceptance,
  type TerminalAuthorityNamespaceOutcomeBoundary,
  type TerminalAuthorityPolicyConsumerIdentity
} from '../../shared/terminal-session-authority-consumer-transport'
import { terminalSessionAuthorityBoundaryId } from '../../shared/terminal-session-authority-boundary-identity'
import {
  observeTerminalAuthorityAppProjection,
  type TerminalAuthorityAppOutcomeManagerOptions
} from './terminal-authority-app-outcome-host-contract'
import {
  assertTerminalAuthorityAppOutcomeConsumer,
  isTerminalAuthorityAppCompleteBoundary,
  type TerminalAuthorityAppCompleteBoundary,
  type TerminalAuthorityAppNamespaceGeneration
} from './terminal-authority-app-outcome-namespace-state'

export function requireTerminalAuthorityAppOutcomeBoundary(
  value: TerminalAuthorityNamespaceOutcomeBoundary
): TerminalAuthorityAppCompleteBoundary {
  const boundary = parseTerminalAuthorityNamespaceOutcomeBoundary(value)
  if (!isTerminalAuthorityAppCompleteBoundary(boundary)) {
    throw new Error('terminal authority app outcome boundary is invalid')
  }
  const { boundaryId, ...unsigned } = boundary
  if (terminalSessionAuthorityBoundaryId(unsigned) !== boundaryId) {
    throw new Error('terminal authority app outcome boundary identity is invalid')
  }
  return boundary
}

export function commitTerminalAuthorityAppOutcomeBoundary(
  options: Readonly<{
    state: TerminalAuthorityAppNamespaceGeneration
    boundary: TerminalAuthorityAppCompleteBoundary
    identity: TerminalAuthorityPolicyConsumerIdentity
    pump: TerminalAuthorityAppOutcomeManagerOptions
  }>
): TerminalAuthorityNamespaceBoundaryAcceptance {
  const { state, boundary } = options
  assertTerminalAuthorityAppOutcomeConsumer(options.identity, boundary.consumer)
  const current = state.boundary
  if (current && boundary.acknowledgedSequence < current.previousSequence) {
    throw new Error('terminal authority app outcome boundary regressed')
  }
  const change = options.pump.store.beginBoundary(boundary)
  observeTerminalAuthorityAppProjection(options.pump, change)
  state.boundary = {
    value: boundary,
    previousSequence: boundary.acknowledgedSequence,
    snapshotCommitted: boundary.acknowledgedSequence === boundary.outcomeHighWatermark
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
    consumer: boundary.consumer,
    namespace: boundary.namespace,
    boundaryId: boundary.boundaryId,
    acknowledgedSequence: boundary.acknowledgedSequence,
    outcomeHighWatermark: boundary.outcomeHighWatermark
  })
}
