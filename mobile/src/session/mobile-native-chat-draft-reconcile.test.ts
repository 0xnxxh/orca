import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  countUserTextOccurrences,
  findLandedImagePreviewEchoes,
  findLandedUnconfirmedSends,
  migrateImagePreviewMessageIds,
  type PendingImagePreviewEcho,
  type UnconfirmedSend
} from './mobile-native-chat-draft-reconcile'

function userText(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  }
}

function pending(id: string, images: string[], expectedOccurrence = 1): PendingImagePreviewEcho {
  return { id, text: '', images, expectedOccurrence, baselineTailMessageId: null }
}

describe('mobile native chat image preview reconciliation', () => {
  it('reconciles a trailing-marker echo and hands its preview to that echo', () => {
    const messages = [
      userText('source', '[Image: source: /tmp/a.png]'),
      userText('prompt', 'look at this[Image #1]')
    ]
    const preview = {
      ...pending('pending', ['file:///a.jpg']),
      text: 'look at this'
    }
    const unconfirmed: UnconfirmedSend = {
      draftKey: 'draft',
      pendingKey: 'pending-key',
      text: 'look at this',
      normalizedText: 'look at this',
      imageCount: 1,
      baselineTailMessageId: null,
      deadline: null
    }

    expect(findLandedUnconfirmedSends(messages, [unconfirmed])).toEqual([unconfirmed])
    expect(findLandedImagePreviewEchoes(messages, [preview])).toEqual([
      { pendingId: 'pending', messageId: 'prompt', images: ['file:///a.jpg'] }
    ])
  })

  it('reconciles prompt-before-source and keeps the prompt as preview owner', () => {
    const messages = [
      userText('prompt', 'look at this[Image #1]'),
      userText('source', '[Image: source: /tmp/a.png]')
    ]
    const preview = { ...pending('pending', ['file:///a.jpg']), text: 'look at this' }
    const unconfirmed: UnconfirmedSend = {
      draftKey: 'draft',
      pendingKey: 'pending-key',
      text: 'look at this',
      normalizedText: 'look at this',
      imageCount: 1,
      baselineTailMessageId: null,
      deadline: null
    }

    expect(findLandedUnconfirmedSends(messages, [unconfirmed])).toEqual([unconfirmed])
    expect(findLandedImagePreviewEchoes(messages, [preview])).toEqual([
      { pendingId: 'pending', messageId: 'prompt', images: ['file:///a.jpg'] }
    ])
  })

  it('reconciles a middle-marker echo without changing its rendered whitespace', () => {
    const messages = [
      userText('source', '[Image: source: /tmp/a.png]'),
      userText('prompt', 'look [Image #1] here')
    ]
    const preview = { ...pending('pending', ['file:///a.jpg']), text: 'look here' }
    const unconfirmed: UnconfirmedSend = {
      draftKey: 'draft',
      pendingKey: 'pending-key',
      text: 'look here',
      normalizedText: 'look here',
      imageCount: 1,
      baselineTailMessageId: null,
      deadline: null
    }

    expect(findLandedUnconfirmedSends(messages, [unconfirmed])).toEqual([unconfirmed])
    expect(findLandedImagePreviewEchoes(messages, [preview])).toEqual([
      { pendingId: 'pending', messageId: 'prompt', images: ['file:///a.jpg'] }
    ])
  })

  it('does not treat markerless text as an unknown-ack literal marker echo', () => {
    const unconfirmed: UnconfirmedSend = {
      draftKey: 'draft',
      pendingKey: 'pending-key',
      text: 'keep [Image #1] literal',
      normalizedText: 'keep [Image #1] literal',
      imageCount: 0,
      baselineTailMessageId: null,
      deadline: null
    }

    expect(findLandedUnconfirmedSends([userText('wrong', 'keep literal')], [unconfirmed])).toEqual(
      []
    )
    expect(
      findLandedUnconfirmedSends([userText('right', 'keep [Image #1] literal')], [unconfirmed])
    ).toEqual([unconfirmed])
  })

  it('does not treat literal marker text as a markerless unknown-ack echo', () => {
    const unconfirmed: UnconfirmedSend = {
      draftKey: 'draft',
      pendingKey: 'pending-key',
      text: 'keep literal',
      normalizedText: 'keep literal',
      imageCount: 0,
      baselineTailMessageId: null,
      deadline: null
    }

    expect(
      findLandedUnconfirmedSends([userText('wrong', 'keep [Image #1] literal')], [unconfirmed])
    ).toEqual([])
    expect(findLandedUnconfirmedSends([userText('right', 'keep literal')], [unconfirmed])).toEqual([
      unconfirmed
    ])
  })

  it('keeps no-image occurrence baselines separate from attached-image turns', () => {
    const messages = [
      userText('source', '[Image: source: /tmp/a.png]'),
      userText('prompt', 'keep [Image #1] literal')
    ]

    expect(countUserTextOccurrences(messages, 'keep literal')).toBe(0)
    expect(countUserTextOccurrences(messages, 'keep literal', 1)).toBe(1)
  })

  it('reconciles multiple transcript text blocks with desktop separators', () => {
    const prompt: NativeChatMessage = {
      ...userText('prompt', 'unused'),
      blocks: [
        { type: 'text', text: 'look' },
        { type: 'image-ref', path: '/tmp/a.png' },
        { type: 'text', text: '[Image #1] here' }
      ]
    }
    const preview = { ...pending('pending', ['file:///a.jpg']), text: 'look here' }

    expect(findLandedImagePreviewEchoes([prompt], [preview])).toEqual([
      { pendingId: 'pending', messageId: 'prompt', images: ['file:///a.jpg'] }
    ])
  })

  it('hands a local preview to a marker-only transcript echo', () => {
    expect(
      findLandedImagePreviewEchoes(
        [userText('prompt', '[Image #1]')],
        [pending('pending', ['file:///a.jpg'])]
      )
    ).toEqual([{ pendingId: 'pending', messageId: 'prompt', images: ['file:///a.jpg'] }])
  })

  it('hands a captioned preview to a marker-only compatibility echo', () => {
    expect(
      findLandedImagePreviewEchoes(
        [userText('prompt', 'look [Image #1] here')],
        [{ ...pending('pending', ['file:///a.jpg']), text: 'look here' }]
      )
    ).toEqual([{ pendingId: 'pending', messageId: 'prompt', images: ['file:///a.jpg'] }])
  })

  it('keeps separate adjacent image-only sends independently reconcilable', () => {
    const landed = findLandedImagePreviewEchoes(
      [
        userText('source-a', '[Image: source: /tmp/a.png]'),
        userText('source-b', '[Image: source: /tmp/b.png]')
      ],
      [pending('pending-a', ['file:///a.jpg']), pending('pending-b', ['file:///b.jpg'], 2)]
    )

    expect(landed).toEqual([
      { pendingId: 'pending-a', messageId: 'source-a', images: ['file:///a.jpg'] },
      { pendingId: 'pending-b', messageId: 'source-b', images: ['file:///b.jpg'] }
    ])
  })

  it('waits for a complete multi-image turn as transcript source frames stream in', () => {
    const entry = pending('pending', ['file:///a.jpg', 'file:///b.jpg'])
    const sourceA = userText('source-a', '[Image: source: /tmp/a.png]')
    const sourceB = userText('source-b', '[Image: source: /tmp/b.png]')

    expect(findLandedImagePreviewEchoes([sourceA], [entry])).toEqual([])
    expect(findLandedImagePreviewEchoes([sourceA, sourceB], [entry])).toEqual([])
    expect(
      findLandedImagePreviewEchoes(
        [sourceA, sourceB, userText('prompt', '[Image #1] [Image #2]')],
        [entry]
      )
    ).toEqual([
      {
        pendingId: 'pending',
        messageId: 'prompt',
        images: ['file:///a.jpg', 'file:///b.jpg']
      }
    ])
  })

  it('moves an early standalone preview to the later folded prompt id', () => {
    const sessionKey = 'host\0worktree\0tab\0session'
    const previous = { [sessionKey]: { source: ['file:///a.jpg'] } }
    const messages = [
      userText('source', '[Image: source: /tmp/a.png]'),
      userText('prompt', '[Image #1]')
    ]

    expect(migrateImagePreviewMessageIds(previous, sessionKey, messages)).toEqual({
      [sessionKey]: { prompt: ['file:///a.jpg'] }
    })
  })

  it('moves an early standalone preview to a trailing-marker prompt id', () => {
    const sessionKey = 'host\0worktree\0tab\0session'
    const previous = { [sessionKey]: { source: ['file:///a.jpg'] } }
    const messages = [
      userText('source', '[Image: source: /tmp/a.png]'),
      userText('prompt', 'look[Image #1]')
    ]

    expect(migrateImagePreviewMessageIds(previous, sessionKey, messages)).toEqual({
      [sessionKey]: { prompt: ['file:///a.jpg'] }
    })
  })

  it('moves a preview when the prompt marker is in a later text block', () => {
    const sessionKey = 'host\0worktree\0tab\0session'
    const previous = { [sessionKey]: { source: ['file:///a.jpg'] } }
    const prompt: NativeChatMessage = {
      ...userText('prompt', 'unused'),
      blocks: [
        { type: 'text', text: 'look' },
        { type: 'text', text: '[Image #1] here' }
      ]
    }

    expect(
      migrateImagePreviewMessageIds(previous, sessionKey, [
        userText('source', '[Image: source: /tmp/a.png]'),
        prompt
      ])
    ).toEqual({ [sessionKey]: { prompt: ['file:///a.jpg'] } })
  })

  it.each([
    ['source before prompt', ['sources', 'prompt']],
    ['prompt before source', ['prompt', 'sources']]
  ])('moves a multi-source preview only with marker parity: %s', (_label, order) => {
    const sessionKey = 'host\0worktree\0tab\0session'
    const previous = {
      [sessionKey]: { sources: ['file:///a.jpg', 'file:///b.jpg', 'file:///c.jpg'] }
    }
    const byId = {
      sources: {
        ...userText('sources', 'unused'),
        blocks: [
          { type: 'text' as const, text: '[Image: source: /tmp/a.png]' },
          { type: 'text' as const, text: '[Image: source: C:\\Users\\me\\b.png]' },
          { type: 'text' as const, text: '[Image: source: /ssh/workspace/c.png]' }
        ]
      },
      prompt: userText('prompt', '[Image #1] [Image #2] [Image #3]')
    }
    const orderedMessages = () => order.map((id) => byId[id as keyof typeof byId])

    expect(migrateImagePreviewMessageIds(previous, sessionKey, orderedMessages())).toEqual({
      [sessionKey]: { prompt: ['file:///a.jpg', 'file:///b.jpg', 'file:///c.jpg'] }
    })
    byId.prompt = userText('prompt', '[Image #1]')
    expect(migrateImagePreviewMessageIds(previous, sessionKey, orderedMessages())).toBe(previous)
  })
})
