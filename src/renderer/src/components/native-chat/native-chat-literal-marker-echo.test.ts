// Outcome-level guard for STA-4363: the render path and the pending-echo key
// path must agree on which `[Image #n]` runs are literal text, or the optimistic
// echo never reconciles and the turn renders twice.

import { describe, expect, it } from 'vitest'
import {
  isImageRefBlock,
  isTextBlock,
  type NativeChatMessage
} from '../../../../shared/native-chat-types'
import { pendingSendsAsMessages, prunePendingSends } from './native-chat-pending'
import type { NativeChatPendingSend } from './native-chat-pending'
import { assembleNativeChatSession } from './native-chat-session-assembler'

function userMessage(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: 1, source: 'transcript' }
}

function assistantMessage(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', text }],
    timestamp: 2,
    source: 'transcript'
  }
}

function assembled(transcript: NativeChatMessage[]): NativeChatMessage[] {
  return assembleNativeChatSession({ sources: { transcript }, sessionId: 's1', agent: 'claude' })
    .messages
}

/** The user rows NativeChatView actually renders: assembled transcript first,
 *  then whichever optimistic echoes are still unrepresented. */
function renderedUserRows(
  transcript: NativeChatMessage[],
  pending: NativeChatPendingSend[]
): NativeChatMessage[] {
  const messages = assembled(transcript)
  return [...messages, ...pendingSendsAsMessages(pending, messages)].filter(
    (message) => message.role === 'user'
  )
}

function rowText(message: NativeChatMessage): string {
  return message.blocks
    .filter(isTextBlock)
    .map((block) => block.text)
    .join('')
}

function rowImagePaths(message: NativeChatMessage): string[] {
  return message.blocks
    .filter(isImageRefBlock)
    .map((block) => block.path ?? block.url ?? '')
    .filter(Boolean)
}

describe('literal image-marker turns in native chat', () => {
  it('shows a standalone marker-only send exactly once', () => {
    const pending: NativeChatPendingSend[] = [{ id: 'p1', text: '[Image #1]', sentAt: 100 }]
    const transcript = [userMessage('m1', '[Image #1]')]

    const rows = renderedUserRows(transcript, pending)

    expect(rows.map(rowText)).toEqual(['[Image #1]'])
  })

  it('shows a marker-only send with surrounding prose exactly once', () => {
    const pending: NativeChatPendingSend[] = [
      { id: 'p1', text: 'keep [Image #1] literal', sentAt: 100 }
    ]
    const transcript = [userMessage('m1', 'keep [Image #1] literal')]

    expect(renderedUserRows(transcript, pending).map(rowText)).toEqual(['keep [Image #1] literal'])
  })

  it('prunes the marker-only echo once the assistant answers it', () => {
    const pending: NativeChatPendingSend[] = [{ id: 'p1', text: '[Image #1]', sentAt: 100 }]
    const transcript = [userMessage('m1', '[Image #1]'), assistantMessage('m2', 'preserved')]

    expect(prunePendingSends(pending, assembled(transcript))).toEqual([])
  })

  it('shows two rapid marker-only sends exactly twice', () => {
    const pending: NativeChatPendingSend[] = [
      { id: 'p1', text: '[Image #1]', sentAt: 100, matchingOccurrence: 1 },
      { id: 'p2', text: '[Image #1]', sentAt: 101, matchingOccurrence: 2 }
    ]
    const transcript = [userMessage('m1', '[Image #1]'), userMessage('m2', '[Image #1]')]

    expect(renderedUserRows(transcript, pending).map(rowText)).toEqual(['[Image #1]', '[Image #1]'])
  })

  it('still strips a real marker that follows an attached image, and echoes once', () => {
    const pending: NativeChatPendingSend[] = [
      { id: 'p1', text: 'look', imagePaths: ['/tmp/a.png'], sentAt: 100 }
    ]
    const transcript = [
      userMessage('src', '[Image: source: /tmp/a.png]'),
      userMessage('prompt', 'look [Image #1]')
    ]

    const rows = renderedUserRows(transcript, pending)

    expect(rows).toHaveLength(1)
    expect(rowText(rows[0]!)).toBe('look')
    expect(rowImagePaths(rows[0]!)).toEqual(['/tmp/a.png'])
  })

  it('still reconciles a caption-less image send whose echo is marker-only', () => {
    const pending: NativeChatPendingSend[] = [
      { id: 'p1', text: '', imagePaths: ['/tmp/a.png'], sentAt: 100 }
    ]
    const transcript = [
      userMessage('src', '[Image: source: /tmp/a.png]'),
      userMessage('prompt', '[Image #1]')
    ]

    const rows = renderedUserRows(transcript, pending)

    expect(rows).toHaveLength(1)
    expect(rowText(rows[0]!)).toBe('')
    expect(rowImagePaths(rows[0]!)).toEqual(['/tmp/a.png'])
  })
})
