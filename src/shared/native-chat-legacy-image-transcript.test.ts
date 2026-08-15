import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from './native-chat-types'
import { normalizeLegacyNativeChatImageTranscriptMessages } from './native-chat-legacy-image-transcript'

function user(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp: 1,
    source: 'transcript'
  }
}

// Exact contract fixture copied from the released v1.4.183 normalizer: source
// rows fold only before a marker-prefixed prompt; an unproved prefix is stripped.
describe('v1.4.183 native-chat image transcript compatibility', () => {
  it('folds one source-before-prompt run with stable prompt ownership', () => {
    const normalized = normalizeLegacyNativeChatImageTranscriptMessages([
      user('source-a', '[Image: source: /tmp/a.png]'),
      user('source-b', '[Image: source: C:\\Users\\me\\b.png]'),
      user('prompt', '[Image #1] [Image #2] compare these')
    ])

    expect(normalized).toEqual([
      {
        ...user('prompt', ''),
        blocks: [
          { type: 'image-ref', path: '/tmp/a.png' },
          { type: 'image-ref', path: 'C:\\Users\\me\\b.png' },
          { type: 'text', text: 'compare these' }
        ]
      }
    ])
  })

  it('strips an unproved released-host marker prefix instead of treating it as literal', () => {
    expect(
      normalizeLegacyNativeChatImageTranscriptMessages([user('prompt', '[Image #1] describe this')])
    ).toEqual([user('prompt', 'describe this')])
  })
})
