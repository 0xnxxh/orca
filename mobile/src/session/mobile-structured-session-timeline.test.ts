import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import {
  buildMobileStructuredTimeline,
  latestMobileStructuredTurnId,
  restoreMobileStructuredAttachments
} from './mobile-structured-session-timeline'
import type { MobileStructuredOutboxEntry } from './mobile-structured-outbox-store'

const APPROVAL: AgentJournalRenderItem = {
  itemId: 'orca:approval',
  revision: 4,
  sequence: 2,
  observedAt: 1,
  body: {
    kind: 'approval',
    title: 'Run command?',
    detail: 'pnpm test',
    options: [{ id: 'accept', label: 'Allow' }],
    resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
  }
}

const OUTBOX: MobileStructuredOutboxEntry = {
  clientMessageId: 'mobile-send:1:id',
  sessionId: 'mobile_1',
  body: {
    kind: 'message',
    role: 'user',
    blocks: [
      { type: 'text', text: 'look' },
      { type: 'image-ref', path: '/tmp/image.png' }
    ]
  },
  previewUris: ['file:///preview.png'],
  state: 'unconfirmed',
  queuedAt: 3,
  lastAttemptAt: 4
}

describe('mobile structured session timeline', () => {
  it('keeps pending prompts as cards and unknown sends as their original bubble', () => {
    const rows = buildMobileStructuredTimeline([APPROVAL], [OUTBOX])

    expect(rows[0]).toMatchObject({ kind: 'prompt', key: 'orca:approval' })
    expect(rows[1]).toMatchObject({
      kind: 'message',
      key: OUTBOX.clientMessageId,
      outbox: { state: 'unconfirmed' },
      message: { blocks: [{ type: 'text', text: 'look' }, { url: 'file:///preview.png' }] }
    })
  })

  it('restores host paths and local previews when a queued send is edited', () => {
    expect(restoreMobileStructuredAttachments(OUTBOX)).toEqual([
      {
        id: `restored:${OUTBOX.clientMessageId}:0`,
        path: '/tmp/image.png',
        previewUri: 'file:///preview.png'
      }
    ])
  })

  it('derives the cancellable turn from the latest Codex item identity', () => {
    expect(
      latestMobileStructuredTurnId([
        APPROVAL,
        { ...APPROVAL, itemId: 'codex:thread-1:turn-7:1', sequence: 5 }
      ])
    ).toBe('turn-7')
  })
})
