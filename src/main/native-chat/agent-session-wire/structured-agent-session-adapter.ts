// What the wire needs from a provider adapter.
//
// Phase 2 implements this over the Codex app-server and the Claude Agent SDK;
// nothing here starts, resumes, or talks to a process. The wire owns the
// journal and the lease, so an adapter only has to answer "did the provider
// take this?" — and it answers `unknown` rather than guessing, because the
// journal renders that as delivery unconfirmed instead of as failure.

import type {
  AgentJournalItemIdentity,
  AgentJournalMessageItem,
  AgentSessionJournalIdentity
} from '../../../shared/agent-session-journal-types'
import type { AgentSessionProviderHandleLink } from '../../../shared/agent-session-provider-handle'
import type { AgentSessionProcessIdentity } from '../../../shared/agent-session-record'
import type { StructuredAgentSessionEventSink } from './structured-agent-session-event-sink'

/** What a reservation turns into once something is actually running under it:
 *  the process the host can probe, and the provider handle it was minted with. */
export type AgentSessionAcquisition = {
  process: AgentSessionProcessIdentity
  link: AgentSessionProviderHandleLink
}

export type AgentSessionDispatchOutcome =
  /** The provider owns the turn now, under this identity. */
  | { state: 'accepted'; providerIdentity: AgentJournalItemIdentity }
  | { state: 'rejected'; reason: string }
  /** The call did not settle. Never re-send on the user's behalf. */
  | { state: 'unknown'; reason: string }

export type StructuredAgentSessionAdapter = {
  /** Makes the reservation real. Called once per reservation, with the spawn
   *  token the lease was reserved under and the fence the handle must be minted
   *  at — the store rejects a link minted at any other fence. */
  acquire(input: {
    identity: AgentSessionJournalIdentity
    fence: number
    spawnToken: string
    /** Where to write everything the provider streams. Handed over here, not
     *  returned, because a provider starts streaming inside this call — before
     *  the journal exists. The sink buffers until it does. Optional so an
     *  adapter that only answers calls needs no journal at all. */
    events?: StructuredAgentSessionEventSink
  }): Promise<AgentSessionAcquisition>
  dispatch(input: {
    sessionId: string
    clientMessageId: string
    body: AgentJournalMessageItem
    fence: number
  }): Promise<AgentSessionDispatchOutcome>
  /** Cancels one turn, not the session: a session-wide interrupt would also kill
   *  a turn the client never asked to stop. */
  cancelTurn(input: {
    sessionId: string
    turnId: string
    fence: number
  }): Promise<{ cancelled: boolean }>
  /** Fires the provider callback for an approval or a question. The wire calls
   *  this only after the durable compare-and-set won, so it runs exactly once. */
  answerPrompt(input: {
    sessionId: string
    itemId: string
    kind: 'approval' | 'question'
    optionId: string
    fence: number
  }): Promise<void>
  setOption(input: { sessionId: string; key: string; value: string; fence: number }): Promise<void>
  /** Transcript path for journal recovery. Omit to let the existing session-file
   *  resolver discover it from the provider session id. */
  historyFilePath?(input: { identity: AgentSessionJournalIdentity }): Promise<string | null>
}
