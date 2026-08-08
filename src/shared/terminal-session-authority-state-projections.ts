import type {
  TerminalAuthorityConsumerProjection,
  TerminalAuthorityProjection,
  TerminalSessionAuthoritySnapshot
} from './terminal-session-authority-mutation'
import type { TerminalSessionAuthorityLegacyState } from './terminal-session-authority-legacy-state'
import type { TerminalSessionAuthorityOutcomeJournal } from './terminal-session-authority-outcome-journal'
import type { TerminalSessionAuthorityTopology } from './terminal-session-authority-topology'
import type { TerminalAuthorityNamespace } from './terminal-session-authority-identity'

export function terminalAuthorityConsumerProjection(
  authority: TerminalAuthorityProjection,
  outcomes: TerminalSessionAuthorityOutcomeJournal,
  consumerId: string,
  consumerIncarnationId: string
): TerminalAuthorityConsumerProjection {
  return Object.freeze({
    authority,
    ...outcomes.cursor(consumerId, consumerIncarnationId)
  })
}

export function terminalAuthorityConsumerClaimProjection(
  authority: TerminalAuthorityProjection,
  outcomes: TerminalSessionAuthorityOutcomeJournal,
  consumerId: string,
  expectedIncarnationId: string | null,
  consumerIncarnationId: string
): TerminalAuthorityConsumerProjection {
  const claim = outcomes.planClaim(consumerId, expectedIncarnationId, consumerIncarnationId)
  const cursor = claim
    ? {
        acknowledgedSequence: claim.acknowledgedSequence,
        outcomeHighWatermark: outcomes.highWatermark
      }
    : outcomes.cursor(consumerId, consumerIncarnationId)
  return Object.freeze({ authority, ...cursor })
}

export function terminalAuthorityStateSnapshot(args: {
  namespace: TerminalAuthorityNamespace
  writerEpoch: number
  revision: number
  topology: TerminalSessionAuthorityTopology
  outcomes: TerminalSessionAuthorityOutcomeJournal
  legacy: TerminalSessionAuthorityLegacyState
}): TerminalSessionAuthoritySnapshot {
  return Object.freeze({
    version: 1,
    namespace: args.namespace,
    writerEpoch: args.writerEpoch,
    revision: args.revision,
    panes: args.topology.paneSnapshot(),
    allocations: args.topology.allocationSnapshot(),
    ...args.outcomes.snapshot(),
    legacyMigrations: args.legacy.migrationSnapshot()
  })
}
