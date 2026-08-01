import {
  AGENT_HOOK_NOTIFICATION_METHOD,
  type AgentHookRelayEnvelope
} from '../shared/agent-hook-relay'
import type { RelayDispatcher } from './dispatcher'

// Why: shed the biggest, most reconstructible fields first — state/paneKey must survive or the pane
// stays stuck on its last spinner, and an over-capacity frame is now dropped rather than sent.
const SHED_ORDER = ['lastAssistantMessage', 'interactivePrompt', 'subagents'] as const

function fitsProducerFrame(dispatcher: RelayDispatcher, envelope: AgentHookRelayEnvelope): boolean {
  return (
    dispatcher.producerEnvelopeBudget(
      AGENT_HOOK_NOTIFICATION_METHOD,
      envelope as unknown as Record<string, unknown>
    ) >= 0
  )
}

/** Publishes an agent-hook envelope, dropping optional detail fields until the frame fits the
 *  smallest attached sink. Publishes the trimmed envelope even if it still does not fit. */
export function publishAgentHookEnvelope(
  dispatcher: RelayDispatcher,
  envelope: AgentHookRelayEnvelope
): void {
  let candidate = envelope
  for (const field of SHED_ORDER) {
    if (fitsProducerFrame(dispatcher, candidate)) {
      break
    }
    if (candidate.payload[field] === undefined) {
      continue
    }
    // Why: the hook server caches envelopes and replays them after --connect, so shedding in place
    // would permanently strip the cached copy too.
    candidate = { ...candidate, payload: { ...candidate.payload } }
    delete candidate.payload[field]
  }
  dispatcher.notify(AGENT_HOOK_NOTIFICATION_METHOD, candidate as unknown as Record<string, unknown>)
}
