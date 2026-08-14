import { describe, expect, it } from 'vitest'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../../shared/agent-session-journal-types'
import { createStructuredAgentSessionOutboxEntry } from '../../../../shared/structured-agent-session-outbox'
import { projectStructuredAgentSessionMessages } from './structured-agent-session-message-projection'

const SEND_COUNT = 8

function submission(index: number): AgentJournalSubmission {
  return {
    clientMessageId: `client-${index}`,
    fence: 1,
    payloadFingerprint: `fingerprint-${index}`,
    dispatchState: 'accepted',
    providerItemId: `provider-${index}`,
    reason: null,
    submittedAt: index,
    resolvedAt: index
  }
}

function item(index: number): AgentJournalRenderItem {
  return {
    itemId: `journal-${index}`,
    revision: 1,
    sequence: index,
    observedAt: index,
    body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: `send ${index}` }] }
  }
}

describe('structured agent session message projection', () => {
  it('renders N rapid accepted sends once when journal and optimistic updates interleave', () => {
    const outbox = Array.from({ length: SEND_COUNT }, (_, index) =>
      createStructuredAgentSessionOutboxEntry({
        clientMessageId: `client-${index}`,
        sessionId: 'session-1',
        text: `send ${index}`,
        attachments: [],
        queuedAt: index
      })
    )
    const messages = projectStructuredAgentSessionMessages(
      Array.from({ length: SEND_COUNT }, (_, index) => item(index)),
      outbox,
      Array.from({ length: SEND_COUNT }, (_, index) => submission(SEND_COUNT - index - 1))
    )

    expect(messages).toHaveLength(SEND_COUNT)
    expect(messages.map((message) => message.id)).toEqual(
      Array.from({ length: SEND_COUNT }, (_, index) => `journal-${index}`)
    )
  })

  it('keeps an optimistic send until its acceptance arrives', () => {
    const outbox = [
      createStructuredAgentSessionOutboxEntry({
        clientMessageId: 'client-pending',
        sessionId: 'session-1',
        text: 'pending',
        attachments: [],
        queuedAt: 1
      })
    ]

    expect(projectStructuredAgentSessionMessages([], outbox, [])).toMatchObject([
      { id: 'client-pending', role: 'user' }
    ])
  })
})
