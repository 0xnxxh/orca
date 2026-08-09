import type {
  AgentJournalItemBody,
  AgentJournalItemIdentity
} from '../../shared/agent-session-journal-types'
import type { NativeChatBlock } from '../../shared/native-chat-types'
import {
  boundInlineText,
  DEFAULT_JOURNAL_PAYLOAD_LIMITS
} from '../native-chat/agent-session-journal/journal-payload-bounds'

// Codex thread items → journal item bodies and durable identities.
//
// THE ORDINAL RULE, and why it is not "index within the turn". Codex renumbers
// item ids positionally on resume (`item-1`…`item-N` across the whole thread),
// and a resumed turn does NOT contain every item the live turn emitted —
// reasoning and command execution are dropped from persisted history. Numbering
// by live position would therefore shift every message after the first tool
// call and hand the user a duplicate of the assistant's answer after a resume.
//
// So the ordinal counts MESSAGE items only, and the same projection is applied
// to the live stream and to a resumed turn's item list. Any other item type —
// including ones this build does not model — is skipped identically on both
// sides, which is what makes the key survive a Codex release that adds one.

/** Only these carry a durable `(threadId, turnId, ordinal)` identity. */
const CODEX_MESSAGE_ITEM_TYPES = new Set(['userMessage', 'agentMessage'])

export type CodexThreadItem = {
  type: string
  id: string
  [key: string]: unknown
}

export function isCodexMessageItemType(type: string): boolean {
  return CODEX_MESSAGE_ITEM_TYPES.has(type)
}

export function readCodexThreadItem(value: unknown): CodexThreadItem | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Record<string, unknown>
  return typeof record.type === 'string' && typeof record.id === 'string'
    ? (record as CodexThreadItem)
    : null
}

/**
 * Ordinals for one thread, assigned on first sight and never reassigned.
 *
 * Non-message items are given no ordinal at all rather than a number from a
 * second counter: a counter that a resumed history cannot reproduce is worse
 * than no key, because it would look reconcilable and reconcile wrongly.
 */
export class CodexTurnOrdinals {
  private readonly turns = new Map<string, Map<string, number>>()

  ordinalFor(turnId: string, codexItemId: string): number {
    const assigned = this.turns.get(turnId) ?? new Map<string, number>()
    this.turns.set(turnId, assigned)
    const existing = assigned.get(codexItemId)
    if (existing !== undefined) {
      return existing
    }
    const ordinal = assigned.size
    assigned.set(codexItemId, ordinal)
    return ordinal
  }

  forgetTurn(turnId: string): void {
    this.turns.delete(turnId)
  }
}

/**
 * Durable identity for a Codex item, or null for one that has none.
 *
 * Non-message items fall back to the `orca` namespace keyed by the Codex item
 * id. That id is unstable across resume, so those rows are live-session detail
 * that a recovered journal simply will not contain — which is correct: Codex
 * itself does not persist them either.
 */
export function codexItemIdentity(input: {
  threadId: string
  turnId: string | null
  item: CodexThreadItem
  ordinals: CodexTurnOrdinals
}): AgentJournalItemIdentity {
  const { item, turnId } = input
  if (turnId && isCodexMessageItemType(item.type)) {
    return {
      provider: 'codex',
      threadId: input.threadId,
      turnId,
      ordinal: input.ordinals.ordinalFor(turnId, item.id)
    }
  }
  return { provider: 'orca', clientMessageId: `codex-item:${input.threadId}:${item.id}` }
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** `userMessage` carries structured content parts; `agentMessage` a flat text. */
export function codexMessageBlocks(item: CodexThreadItem): NativeChatBlock[] {
  const text = readString(item, 'text')
  if (text !== null) {
    return [{ type: 'text', text }]
  }
  const content = item.content
  if (!Array.isArray(content)) {
    return []
  }
  const blocks: NativeChatBlock[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) {
      continue
    }
    const partText = readString(part as Record<string, unknown>, 'text')
    if (partText !== null) {
      blocks.push({ type: 'text', text: partText })
    }
  }
  return blocks
}

/** Codex reports `inProgress` then a terminal status; a zero exit code is the
 *  only thing that makes a finished command a success. */
function commandState(item: CodexThreadItem): 'running' | 'completed' | 'failed' {
  const status = readString(item, 'status')
  if (status === null || status === 'inProgress') {
    return 'running'
  }
  if (status !== 'completed') {
    return 'failed'
  }
  const exitCode = item.exitCode
  return typeof exitCode === 'number' && exitCode !== 0 ? 'failed' : 'completed'
}

function commandBody(item: CodexThreadItem): AgentJournalItemBody {
  const output = readString(item, 'aggregatedOutput')
  return {
    kind: 'tool-call',
    name: 'shell',
    input: { command: item.command ?? null, cwd: item.cwd ?? null },
    state: commandState(item),
    ...(output === null
      ? {}
      : { output: boundInlineText(output, DEFAULT_JOURNAL_PAYLOAD_LIMITS).bounded })
  }
}

/**
 * Journal body for a Codex item, or null for one with nothing to render.
 *
 * An unmodelled item type is skipped rather than journaled as a placeholder: a
 * row the client cannot render is worse than a gap, and the ordinal projection
 * already guarantees skipping it costs the following messages nothing.
 */
export function codexItemBody(item: CodexThreadItem): AgentJournalItemBody | null {
  if (item.type === 'userMessage' || item.type === 'agentMessage') {
    const blocks = codexMessageBlocks(item)
    return blocks.length === 0
      ? null
      : { kind: 'message', role: item.type === 'userMessage' ? 'user' : 'assistant', blocks }
  }
  if (item.type === 'commandExecution') {
    return commandBody(item)
  }
  if (item.type === 'fileChange') {
    return {
      kind: 'tool-call',
      name: 'apply_patch',
      input: { changes: item.changes ?? null },
      state: commandState(item)
    }
  }
  if (item.type === 'reasoning') {
    const text = readString(item, 'text') ?? readString(item, 'summary')
    return text === null ? null : { kind: 'status', text }
  }
  return null
}

/** Snapshot body for text still streaming, before its item completes. */
export function codexStreamingMessageBody(text: string): AgentJournalItemBody {
  return { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] }
}
