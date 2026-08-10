import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'

function boundedText(payload: { head: string; truncated: boolean; byteLength: number }): string {
  return payload.truncated ? `${payload.head}\n… (${payload.byteLength} bytes)` : payload.head
}

function itemBlocks(item: AgentJournalRenderItem): {
  role: NativeChatMessage['role']
  blocks: NativeChatBlock[]
} {
  const body = item.body
  if (body.kind === 'message') {
    return { role: body.role, blocks: body.blocks }
  }
  if (body.kind === 'tool-call') {
    return {
      role: 'assistant',
      blocks: [
        { type: 'tool-call', name: body.name, input: body.input },
        ...(body.output
          ? [
              {
                type: 'tool-result' as const,
                output: boundedText(body.output),
                isError: body.state === 'failed'
              }
            ]
          : [])
      ]
    }
  }
  if (body.kind === 'diff') {
    return {
      role: 'assistant',
      blocks: [
        { type: 'tool-call', name: 'Diff', input: { path: body.path } },
        { type: 'tool-result', output: boundedText(body.patch) }
      ]
    }
  }
  if (body.kind === 'approval') {
    const suffix = body.resolution.state === 'pending' ? 'Awaiting response' : body.resolution.state
    return {
      role: 'system',
      blocks: [{ type: 'text', text: `${body.title}\n${body.detail ?? ''}\n${suffix}`.trim() }]
    }
  }
  if (body.kind === 'question') {
    const choices = body.options.map((option) => option.label).join(' · ')
    return {
      role: 'system',
      blocks: [{ type: 'text', text: `${body.question}\n${choices}`.trim() }]
    }
  }
  return { role: 'system', blocks: [{ type: 'text', text: body.text }] }
}

export function projectStructuredItemsToNativeChat(
  items: readonly AgentJournalRenderItem[]
): NativeChatMessage[] {
  return items.map((item) => {
    const projected = itemBlocks(item)
    return {
      id: item.itemId,
      role: projected.role,
      blocks: projected.blocks,
      timestamp: item.observedAt,
      source: 'transcript'
    }
  })
}
