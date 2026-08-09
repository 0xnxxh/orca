import type { AgentJournalItemIdentity } from '../../shared/agent-session-journal-types'
import { agentJournalItemKey } from '../../shared/agent-session-journal-item-key'
import {
  createAgentSessionDeltaCoalescer,
  type AgentSessionDeltaCoalescerDeps
} from '../native-chat/agent-session-wire/agent-session-delta-coalescer'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import type { CodexStructuredSessionEvent } from './codex-structured-session-adapter'
import {
  codexItemBody,
  codexItemIdentity,
  codexStreamingMessageBody,
  CodexTurnOrdinals,
  readCodexThreadItem
} from './codex-structured-item-translation'
import {
  codexApprovalItem,
  codexPromptIdentity,
  codexQuestionItems
} from './codex-structured-prompt-items'
import { CODEX_USER_INPUT_METHOD } from './codex-structured-prompt-replies'

// The one place Codex events become journal rows.
//
// Every durable decision lives here rather than in the adapter: the adapter
// knows the protocol, this knows what a user is owed after a reconnect. It is
// per-session and per-acquisition — a new lease gets a new translator and a new
// sink, so a superseded child cannot keep writing.

const AGENT_MESSAGE_DELTA_METHOD = 'item/agentMessage/delta'

export type CodexJournalTranslatorDeps = {
  sink: StructuredAgentSessionEventSink
  /** Points an answered journal item back at the live Codex request. */
  bindPromptItemId?: (journalItemId: string, promptKey: string) => void
  coalesceMs?: number
  schedule?: AgentSessionDeltaCoalescerDeps['schedule']
}

export type CodexJournalTranslator = {
  handle: (event: CodexStructuredSessionEvent) => void
  dispose: () => void
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function createCodexJournalTranslator(
  deps: CodexJournalTranslatorDeps
): CodexJournalTranslator {
  const ordinals = new CodexTurnOrdinals()
  /** Identity assigned when an item was announced, reused by its deltas and by
   *  its completion so all three upsert one row. */
  const identities = new Map<string, AgentJournalItemIdentity>()
  /** What each announced item is, so an approval can name what it approves. */
  const details = new Map<string, string>()
  let currentTurnId: string | null = null

  const coalescer = createAgentSessionDeltaCoalescer({
    windowMs: deps.coalesceMs,
    schedule: deps.schedule,
    emit: (codexItemId, text) => {
      const identity = identities.get(codexItemId)
      if (!identity) {
        return
      }
      deps.sink.appendItem(identity, codexStreamingMessageBody(text))
      deps.sink.publish()
    }
  })

  const identityFor = (
    threadId: string,
    turnId: string | null,
    item: { type: string; id: string }
  ): AgentJournalItemIdentity => {
    const existing = identities.get(item.id)
    if (existing) {
      return existing
    }
    const identity = codexItemIdentity({ threadId, turnId, item, ordinals })
    identities.set(item.id, identity)
    return identity
  }

  const handleItemEvent = (event: { threadId: string; method: string; params: unknown }): void => {
    const params = readRecord(event.params)
    const item = readCodexThreadItem(params.item)
    if (!item) {
      return
    }
    const turnId = readString(params, 'turnId') ?? currentTurnId
    const identity = identityFor(event.threadId, turnId, item)
    const body = codexItemBody(item)
    const command = readString(item, 'command')
    if (command) {
      details.set(item.id, command)
    }
    if (event.method === 'item/completed') {
      // The completed body is authoritative; the coalesced text is now stale.
      coalescer.forget(item.id)
    }
    if (!body) {
      return
    }
    deps.sink.appendItem(identity, body)
    deps.sink.publish()
  }

  // The row is keyed by the prompt and the announced command is looked up by the
  // tool item, because one item can ask more than once.
  const handlePrompt = (event: {
    threadId: string
    method: string
    params: unknown
    codexItemId: string
    promptKey: string
  }): void => {
    if (event.method === CODEX_USER_INPUT_METHOD) {
      for (const question of codexQuestionItems({
        threadId: event.threadId,
        promptKey: event.promptKey,
        params: event.params
      })) {
        deps.sink.appendItem(question.identity, question.body)
        deps.bindPromptItemId?.(agentJournalItemKey(question.identity), event.promptKey)
      }
      deps.sink.publish()
      return
    }
    const identity = codexPromptIdentity({
      threadId: event.threadId,
      promptKey: event.promptKey
    })
    deps.sink.appendItem(
      identity,
      codexApprovalItem({
        method: event.method,
        params: event.params,
        detail: details.get(event.codexItemId) ?? null
      })
    )
    deps.bindPromptItemId?.(agentJournalItemKey(identity), event.promptKey)
    deps.sink.publish()
  }

  return {
    handle: (event) => {
      if (event.type === 'ended') {
        coalescer.flushAll()
        return
      }
      if (event.type === 'notification' && event.method === AGENT_MESSAGE_DELTA_METHOD) {
        const params = readRecord(event.params)
        const codexItemId = readString(params, 'itemId')
        const delta = params.delta
        if (codexItemId && typeof delta === 'string') {
          coalescer.append(codexItemId, delta)
        }
        return
      }
      // Lifecycle bypass: nothing may be journaled ahead of the text it follows.
      coalescer.flushAll()
      if (event.type === 'prompt') {
        handlePrompt(event)
        return
      }
      if (event.method === 'turn/started') {
        currentTurnId = readString(readRecord(readRecord(event.params).turn), 'id')
        return
      }
      if (event.method === 'turn/completed') {
        // A later item with no turn of its own belongs to no turn, not to the
        // one that just ended.
        currentTurnId = null
        return
      }
      if (event.method === 'item/started' || event.method === 'item/completed') {
        handleItemEvent(event)
      }
    },
    dispose: () => {
      coalescer.dispose()
      identities.clear()
      details.clear()
    }
  }
}
