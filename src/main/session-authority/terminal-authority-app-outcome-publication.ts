import {
  TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
  type TerminalAuthorityNamespaceOutcomePublication
} from '../../shared/terminal-session-authority-consumer-transport'
import {
  observeTerminalAuthorityAppProjection,
  type TerminalAuthorityAppOutcomeManagerOptions,
  type TerminalAuthorityAppProjectionObservation
} from './terminal-authority-app-outcome-host-contract'
import {
  assertTerminalAuthorityAppOutcomeConsumer,
  requireTerminalAuthorityAppOutcomeConnection,
  type TerminalAuthorityAppNamespaceGeneration
} from './terminal-authority-app-outcome-namespace-state'

export async function applyTerminalAuthorityAppOutcomePublication(
  state: TerminalAuthorityAppNamespaceGeneration,
  publication: TerminalAuthorityNamespaceOutcomePublication,
  options: TerminalAuthorityAppOutcomeManagerOptions,
  acknowledgeTimeoutMs: number,
  assertCurrent: () => void
): Promise<void> {
  assertCurrent()
  const connection = requireTerminalAuthorityAppOutcomeConnection(state)
  assertTerminalAuthorityAppOutcomeConsumer(connection.grant.consumer, publication.consumer)
  const boundary = state.boundary
  if (!boundary || publication.previousSequence !== boundary.previousSequence) {
    throw new Error('terminal authority app outcome publication has a cursor gap')
  }
  const outcomes = publication.outcomes ?? [publication.outcome]
  const target = outcomes.at(-1)!
  if (!boundary.snapshotCommitted && target.sequence > boundary.value.outcomeHighWatermark) {
    throw new Error('terminal authority app outcome publication crossed its snapshot boundary')
  }
  const applied = options.store.apply(publication)
  let reconciled: TerminalAuthorityAppProjectionObservation | null = null
  if (!boundary.snapshotCommitted && target.sequence === boundary.value.outcomeHighWatermark) {
    assertCurrent()
    reconciled = options.store.completeBoundary(boundary.value)
    boundary.snapshotCommitted = true
  }
  observeTerminalAuthorityAppProjection(options, applied)
  if (reconciled) {
    observeTerminalAuthorityAppProjection(options, reconciled)
  }
  assertCurrent()
  const acknowledged = await state.work.settle(
    connection.acknowledge({
      version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
      consumer: publication.consumer,
      namespace: publication.namespace,
      sequence: target.sequence,
      outcomeId: target.outcomeId
    }),
    acknowledgeTimeoutMs,
    'ACK'
  )
  assertCurrent()
  if (acknowledged !== target.sequence) {
    throw new Error('terminal authority app outcome ACK changed sequence')
  }
  boundary.previousSequence = acknowledged
}
