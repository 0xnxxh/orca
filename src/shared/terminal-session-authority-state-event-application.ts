import { failTerminalSessionAuthority } from './terminal-session-authority-mutation'
import type {
  TerminalAuthorityOutcome,
  TerminalSessionAuthorityLogEvent,
  TerminalSessionAuthorityMutationRequest
} from './terminal-session-authority-mutation'
import type { TerminalSessionAuthorityOutcomeJournal } from './terminal-session-authority-outcome-journal'
import { assertSemanticallyEqual } from './terminal-session-authority-semantic-equality'
import { applyTerminalAuthoritySemanticRecord } from './terminal-session-authority-semantic-outcome'
import type { TerminalAuthorityTransitionView } from './terminal-session-authority-transition'
import type { TerminalSessionAuthorityLegacyState } from './terminal-session-authority-legacy-state'
import type { TerminalSessionAuthorityTopology } from './terminal-session-authority-topology'

export function applyTerminalAuthorityStateEvent(args: {
  event: TerminalSessionAuthorityLogEvent
  revision: number
  setRevision: (revision: number) => void
  legacy: TerminalSessionAuthorityLegacyState
  topology: TerminalSessionAuthorityTopology
  outcomes: TerminalSessionAuthorityOutcomeJournal
  view: TerminalAuthorityTransitionView
  planMutation: (
    request: TerminalSessionAuthorityMutationRequest,
    replayPersistedEvent: boolean
  ) => { outcome: TerminalAuthorityOutcome; duplicate: boolean }
}): void {
  const event = args.event
  if (event.kind === 'legacy-migration') {
    if (event.migration.authorityRevision !== args.revision + 1) {
      failTerminalSessionAuthority('record-corrupt', 'legacy migration revision is not contiguous')
    }
    args.legacy.apply(event.migration, args.topology)
    args.setRevision(event.migration.authorityRevision)
    return
  }
  if (event.kind === 'consumer-claim') {
    args.outcomes.applyClaim(event)
    return
  }
  if (event.kind === 'consumer-retire') {
    args.outcomes.applyRetire(event)
    return
  }
  if (event.kind === 'outcome-ack') {
    args.outcomes.applyAck(event)
    return
  }
  if (event.kind === 'semantic-outcome') {
    applyTerminalAuthoritySemanticRecord(args.view, args.outcomes, event.outcome)
    return
  }
  const planned = args.planMutation(event.outcome.request, true)
  if (planned.duplicate) {
    failTerminalSessionAuthority('record-corrupt', 'mutation record repeats a durable operation')
  }
  assertSemanticallyEqual(planned.outcome, event.outcome, 'mutation result is not canonical')
  args.topology.apply(event.outcome.result)
  for (const effect of event.outcome.result.effects) {
    if (effect.kind === 'binding-retired') {
      args.outcomes.retireSemanticProducers(effect.binding)
    }
  }
  args.setRevision(event.outcome.result.revision)
  args.outcomes.applyOutcome(event.outcome)
}
