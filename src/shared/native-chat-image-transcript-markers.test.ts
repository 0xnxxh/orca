import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from './native-chat-types'
import {
  isImageSourceUserTurn,
  nativeChatUserMessageMatchText,
  nativeChatUserTextMatchText,
  normalizeImageTranscriptMessages,
  normalizeNativeChatUserText,
  normalizedNativeChatUserMessageText,
  stripImagePromptMarker
} from './native-chat-image-transcript-markers'

function userText(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp: 1,
    source: 'transcript'
  }
}

function multiImageSource(id = 'sources'): NativeChatMessage {
  return {
    ...userText(id, 'unused'),
    blocks: [
      { type: 'text', text: '[Image: source: /tmp/a.png]' },
      { type: 'text', text: '[Image: source: C:\\Users\\me\\b.png]' },
      { type: 'text', text: '[Image: source: /ssh/workspace/c.png]' }
    ]
  }
}

describe('normalizeImageTranscriptMessages', () => {
  it('merges the paired [Image: source]/[Image #1] turns into one image-ref turn', () => {
    const out = normalizeImageTranscriptMessages([
      userText('a', '[Image: source: /tmp/orca-paste-1-2.png]'),
      userText('b', '[Image #1] describe this')
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.blocks).toEqual([
      { type: 'image-ref', path: '/tmp/orca-paste-1-2.png' },
      { type: 'text', text: 'describe this' }
    ])
  })

  it('merges the real prompt-before-source transcript order', () => {
    const out = normalizeImageTranscriptMessages([
      userText('prompt', '[Image #1] describe this'),
      userText('source', '[Image: source: /tmp/orca-paste-1-2.png]')
    ])

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'prompt' })
    expect(out[0]!.blocks).toEqual([
      { type: 'image-ref', path: '/tmp/orca-paste-1-2.png' },
      { type: 'text', text: 'describe this' }
    ])
  })

  it('merges a source turn into a prompt with a trailing image marker', () => {
    const out = normalizeImageTranscriptMessages([
      userText('a', '[Image: source: /tmp/orca-paste-1-2.png]'),
      userText('b', 'describe this[Image #1]')
    ])

    expect(out).toHaveLength(1)
    expect(out[0]!.blocks).toEqual([
      { type: 'image-ref', path: '/tmp/orca-paste-1-2.png' },
      { type: 'text', text: 'describe this' }
    ])
  })

  it('folds and strips markers in later text blocks', () => {
    const prompt: NativeChatMessage = {
      ...userText('prompt', 'unused'),
      blocks: [
        { type: 'text', text: 'describe' },
        { type: 'image-ref', path: '/tmp/existing.png' },
        { type: 'text', text: '[Image #1] this' }
      ]
    }
    const out = normalizeImageTranscriptMessages([
      userText('source', '[Image: source: /tmp/a.png]'),
      prompt
    ])

    expect(out).toHaveLength(1)
    expect(out[0]?.blocks).toEqual([
      { type: 'image-ref', path: '/tmp/a.png' },
      { type: 'text', text: 'describe' },
      { type: 'image-ref', path: '/tmp/existing.png' },
      { type: 'text', text: 'this' }
    ])
  })

  it.each([
    ['[Image #1] describe this', 'describe this'],
    ['[Image #1]\t  describe this', 'describe this'],
    [' \t[Image #1] describe this', 'describe this'],
    ['describe this [Image #1]', 'describe this'],
    ['describe this  \t[Image #1]', 'describe this'],
    ['describe this [Image #1]\t  ', 'describe this'],
    ['describe [Image #1] this', 'describe  this'],
    ['describe  [Image #1]\t this', 'describe  \t this'],
    ['describe[Image #1]\t  this', 'describe\t  this'],
    ['describe\n[Image #1]\nthis', 'describe\n\nthis'],
    ['com[Image #1]pare this', 'compare this'],
    ['[Image #1] [Image #2]', ''],
    ['literal [Image #x] text', 'literal [Image #x] text']
  ])('strips image prompt markers anywhere in text', (text, expected) => {
    expect(stripImagePromptMarker(text)).toBe(expected)
  })

  it('returns long marker-free whitespace without regex backtracking', () => {
    const text = ' '.repeat(50_000)
    expect(stripImagePromptMarker(text)).toBe(text)
  })

  it('shares marker-aware text matching across multiple text blocks', () => {
    const message: NativeChatMessage = {
      ...userText('prompt', 'unused'),
      blocks: [
        { type: 'text', text: 'look' },
        { type: 'image-ref', path: '/tmp/a.png' },
        { type: 'text', text: '[Image #1]   here' }
      ]
    }

    expect(normalizeNativeChatUserText(' look [Image #1]   here ')).toBe('look here')
    expect(normalizedNativeChatUserMessageText(message)).toBe('look here')
  })

  it('keeps markers in no-image match keys without changing real image keys', () => {
    expect(nativeChatUserTextMatchText(' keep [Image #1] literal ', false)).toBe(
      'keep [Image #1] literal'
    )
    expect(nativeChatUserTextMatchText(' keep [Image #1] literal ', true)).toBe('keep literal')

    const literal = userText('literal', 'keep [Image #1] literal')
    const attached = {
      ...literal,
      blocks: [{ type: 'image-ref' as const, path: '/tmp/a.png' }, ...literal.blocks]
    }
    expect(nativeChatUserMessageMatchText(literal)).toBe('keep [Image #1] literal')
    expect(nativeChatUserMessageMatchText(attached)).toBe('keep literal')
  })

  it('recognizes only all-source-text user turns', () => {
    const source = userText('source', '[Image: source: /tmp/a.png]')
    expect(isImageSourceUserTurn(source)).toBe(true)
    expect(isImageSourceUserTurn(multiImageSource())).toBe(true)
    expect(isImageSourceUserTurn({ ...source, role: 'assistant' })).toBe(false)
    expect(
      isImageSourceUserTurn({
        ...source,
        blocks: [...source.blocks, { type: 'text', text: 'caption' }]
      })
    ).toBe(false)
  })

  it('converts a lone [Image: source] turn (no prompt) into an image-ref instead of raw text', () => {
    const out = normalizeImageTranscriptMessages([
      userText('a', '[Image: source: /Users/me/Pictures/hero-image-2.png]')
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.blocks).toEqual([
      { type: 'image-ref', path: '/Users/me/Pictures/hero-image-2.png' }
    ])
  })

  it('folds every source and strips every prompt marker for a multi-image send', () => {
    const out = normalizeImageTranscriptMessages([
      userText('a', '[Image: source: /tmp/a.png]'),
      userText('b', '[Image: source: /tmp/b.png]'),
      userText('c', '[Image: source: /tmp/c.png]'),
      userText('prompt', '[Image #1] [Image #2] [Image #3] compare these')
    ])

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'prompt' })
    expect(out[0]!.blocks).toEqual([
      { type: 'image-ref', path: '/tmp/a.png' },
      { type: 'image-ref', path: '/tmp/b.png' },
      { type: 'image-ref', path: '/tmp/c.png' },
      { type: 'text', text: 'compare these' }
    ])
  })

  it.each([
    [
      'source before prompt',
      [multiImageSource(), userText('prompt', '[Image #1] [Image #2] [Image #3] compare these')]
    ],
    [
      'prompt before source',
      [userText('prompt', '[Image #1] [Image #2] [Image #3] compare these'), multiImageSource()]
    ]
  ])('folds one multi-source record in %s order', (_label, messages) => {
    const out = normalizeImageTranscriptMessages(messages)

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'prompt' })
    expect(out[0]!.blocks).toEqual([
      { type: 'image-ref', path: '/tmp/a.png' },
      { type: 'image-ref', path: 'C:\\Users\\me\\b.png' },
      { type: 'image-ref', path: '/ssh/workspace/c.png' },
      { type: 'text', text: 'compare these' }
    ])
  })

  it('does not let one marker claim one record containing three sources', () => {
    const out = normalizeImageTranscriptMessages([
      userText('prompt', '[Image #1] compare these'),
      multiImageSource()
    ])

    expect(out).toHaveLength(2)
    expect(out[0]?.blocks).toEqual([{ type: 'text', text: '[Image #1] compare these' }])
    expect(out[1]?.blocks).toEqual([
      { type: 'image-ref', path: '/tmp/a.png' },
      { type: 'image-ref', path: 'C:\\Users\\me\\b.png' },
      { type: 'image-ref', path: '/ssh/workspace/c.png' }
    ])
  })

  it('keeps all image refs when a multi-image send has no caption', () => {
    const out = normalizeImageTranscriptMessages([
      userText('a', '[Image: source: /tmp/a.png]'),
      userText('b', '[Image: source: /tmp/b.png]'),
      userText('prompt', '[Image #1] [Image #2]')
    ])

    expect(out).toHaveLength(1)
    expect(out[0]!.blocks).toEqual([
      { type: 'image-ref', path: '/tmp/a.png' },
      { type: 'image-ref', path: '/tmp/b.png' }
    ])
  })

  it('folds prompt-before-source multi-image turns symmetrically', () => {
    const out = normalizeImageTranscriptMessages([
      userText('prompt', '[Image #1] [Image #2] compare these'),
      userText('a', '[Image: source: /tmp/a.png]'),
      userText('b', '[Image: source: /tmp/b.png]')
    ])

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'prompt' })
    expect(out[0]!.blocks).toEqual([
      { type: 'image-ref', path: '/tmp/a.png' },
      { type: 'image-ref', path: '/tmp/b.png' },
      { type: 'text', text: 'compare these' }
    ])
  })

  it.each([
    ['source before prompt', ['source-a', 'source-b', 'source-c', 'prompt']],
    ['prompt before source', ['prompt', 'source-a', 'source-b', 'source-c']]
  ])('does not let one marker prove three image sources: %s', (_label, order) => {
    const byId = {
      'source-a': userText('source-a', '[Image: source: /tmp/a.png]'),
      'source-b': userText('source-b', '[Image: source: /tmp/b.png]'),
      'source-c': userText('source-c', '[Image: source: /tmp/c.png]'),
      prompt: userText('prompt', '[Image #1] compare these')
    }
    const out = normalizeImageTranscriptMessages(order.map((id) => byId[id as keyof typeof byId]))

    expect(out).toHaveLength(4)
    expect(out.find((message) => message.id === 'prompt')?.blocks).toEqual([
      { type: 'text', text: '[Image #1] compare these' }
    ])
    expect(
      out.flatMap((message) => message.blocks).filter((block) => block.type === 'image-ref')
    ).toHaveLength(3)
  })

  it('preserves adjacent standalone image turns without a prompt marker', () => {
    const out = normalizeImageTranscriptMessages([
      userText('a', '[Image: source: /tmp/a.png]'),
      userText('b', '[Image: source: /tmp/b.png]')
    ])

    expect(out).toHaveLength(2)
    expect(out.map((message) => message.id)).toEqual(['a', 'b'])
    expect(out.map((message) => message.blocks)).toEqual([
      [{ type: 'image-ref', path: '/tmp/a.png' }],
      [{ type: 'image-ref', path: '/tmp/b.png' }]
    ])
  })

  it('leaves ordinary user text untouched', () => {
    const message = userText('a', 'keep [Image #1] as literal text')
    const messages = [message]
    const out = normalizeImageTranscriptMessages(messages)
    expect(out).toBe(messages)
    expect(out[0]).toBe(message)
    expect(out[0]!.blocks).toBe(message.blocks)
  })

  it('removes a whitespace-only first text block', () => {
    const out = normalizeImageTranscriptMessages([userText('a', '   ')])

    expect(out[0]?.blocks).toEqual([])
  })

  it('preserves unaffected rows when another row needs normalization', () => {
    const before = userText('before', 'keep this row')
    const marker = userText('marker', '[Image: source: /tmp/image.png]')
    const after = userText('after', 'keep this row too')
    const messages = [before, marker, after]

    const out = normalizeImageTranscriptMessages(messages)

    expect(out).not.toBe(messages)
    expect(out[0]).toBe(before)
    expect(out[2]).toBe(after)
  })

  it('leaves assistant messages untouched', () => {
    const assistant: NativeChatMessage = {
      id: 'a',
      role: 'assistant',
      blocks: [{ type: 'text', text: '[Image: source: /tmp/x.png]' }],
      timestamp: 1,
      source: 'transcript'
    }
    expect(normalizeImageTranscriptMessages([assistant])).toEqual([assistant])
  })
})
