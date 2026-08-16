import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'

function user(id: string, text: string) {
  return {
    id,
    role: 'user',
    source: 'transcript',
    blocks: [{ type: 'text', text }]
  } as NativeChatMessage
}
function shape(messages: NativeChatMessage[]) {
  return messages.map((m) =>
    m.blocks.map((b) => (b.type === 'text' ? `T:${b.text}` : `IMG:${(b as { path: string }).path}`))
  )
}

describe('STA-4363 mobile render-data', () => {
  it('M1 preserves a standalone literal marker turn', () => {
    expect(shape(foldMobileNativeChatMessages([user('u1', 'Please preserve [Image #1] literally')])))
      .toEqual([['T:Please preserve [Image #1] literally']])
  })

  it('M2 preserves a marker-only standalone turn', () => {
    expect(shape(foldMobileNativeChatMessages([user('u1', '[Image #1]')]))).toEqual([
      ['T:[Image #1]']
    ])
  })

  it('M3 DISCRIMINATING: source run, non-image turn, then literal marker prompt', () => {
    expect(
      shape(
        foldMobileNativeChatMessages([
          user('s1', '[Image: source: /tmp/a.jpg]'),
          user('u1', 'here is the picture'),
          user('u2', 'Please preserve [Image #1] literally')
        ])
      )
    ).toEqual([
      ['IMG:/tmp/a.jpg'],
      ['T:here is the picture'],
      ['T:Please preserve [Image #1] literally']
    ])
  })

  it('M4 still folds a genuine contiguous source -> prompt pair', () => {
    expect(
      shape(
        foldMobileNativeChatMessages([
          user('s1', '[Image: source: /tmp/a.jpg]'),
          user('u1', '[Image #1] what is this?')
        ])
      )
    ).toEqual([['IMG:/tmp/a.jpg', 'T:what is this?']])
  })

  it('M5 prompt-first: literal marker turn immediately followed by an image source', () => {
    console.log(
      'MOBILE CASE D =>',
      JSON.stringify(
        shape(
          foldMobileNativeChatMessages([
            user('u1', 'Please preserve [Image #1] literally'),
            user('s1', '[Image: source: /tmp/a.jpg]')
          ])
        )
      )
    )
  })
})
