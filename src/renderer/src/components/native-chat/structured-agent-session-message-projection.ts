import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../../shared/agent-session-journal-types'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import {
  reconcileStructuredAgentSessionOutbox,
  type StructuredAgentSessionOutboxEntry
} from '../../../../shared/structured-agent-session-outbox'
import { projectStructuredItemsToNativeChat } from '../../../../shared/structured-agent-session-projection'

export function projectStructuredAgentSessionMessages(
  items: readonly AgentJournalRenderItem[],
  outbox: readonly StructuredAgentSessionOutboxEntry[],
  submissions: readonly AgentJournalSubmission[]
): NativeChatMessage[] {
  const optimistic = reconcileStructuredAgentSessionOutbox(outbox, submissions)
  return [
    ...projectStructuredItemsToNativeChat(items),
    ...optimistic.map(
      (entry): NativeChatMessage => ({
        id: entry.clientMessageId,
        role: 'user',
        source: 'transcript',
        timestamp: entry.queuedAt,
        blocks: entry.body.blocks
      })
    )
  ]
}
