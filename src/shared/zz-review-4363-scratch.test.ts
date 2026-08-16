import { describe, expect, it } from 'vitest'
import { normalizeImageTranscriptMessages } from './native-chat-image-transcript-markers'
import type { NativeChatMessage } from './native-chat-types'

function user(id: string, text: string, source: NativeChatMessage['source'] = 'transcript') {
  return { id, role: 'user', source, blocks: [{ type: 'text', text }] } as NativeChatMessage
}
function assistant(id: string, text: string) {
  return {
    id,
    role: 'assistant',
    source: 'transcript',
    blocks: [{ type: 'text', text }]
  } as NativeChatMessage
}
function texts(messages: NativeChatMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    blocks: m.blocks.map((b) =>
      b.type === 'text' ? `T:${b.text}` : b.type === 'image-ref' ? `IMG:${b.path}` : b.type
    )
  }))
}

describe('STA-4363 review scratch', () => {
  it('A. standalone literal marker turn is preserved', () => {
    const out = normalizeImageTranscriptMessages([user('u1', 'Please preserve [Image #1] literally')])
    expect(texts(out)).toEqual([
      { role: 'user', blocks: ['T:Please preserve [Image #1] literally'] }
    ])
  })

  it('B. DISCRIMINATING: image-source run, then a non-image turn, then a literal marker prompt', () => {
    const out = normalizeImageTranscriptMessages([
      user('s1', '[Image: source: /tmp/a.jpg]'),
      user('u1', 'here is the picture'),
      assistant('a1', 'ok'),
      user('u2', 'Please preserve [Image #1] literally')
    ])
    expect(texts(out)).toEqual([
      { role: 'user', blocks: ['IMG:/tmp/a.jpg'] },
      { role: 'user', blocks: ['T:here is the picture'] },
      { role: 'assistant', blocks: ['T:ok'] },
      { role: 'user', blocks: ['T:Please preserve [Image #1] literally'] }
    ])
  })

  it('B2. DISCRIMINATING (no assistant in between): source run, non-image user turn, literal marker prompt', () => {
    const out = normalizeImageTranscriptMessages([
      user('s1', '[Image: source: /tmp/a.jpg]'),
      user('u1', 'here is the picture'),
      user('u2', 'Please preserve [Image #1] literally')
    ])
    expect(texts(out)).toEqual([
      { role: 'user', blocks: ['IMG:/tmp/a.jpg'] },
      { role: 'user', blocks: ['T:here is the picture'] },
      { role: 'user', blocks: ['T:Please preserve [Image #1] literally'] }
    ])
  })

  it('C. genuine contiguous source->prompt still folds', () => {
    const out = normalizeImageTranscriptMessages([
      user('s1', '[Image: source: /tmp/a.jpg]'),
      user('u1', '[Image #1] what is this?')
    ])
    expect(texts(out)).toEqual([
      { role: 'user', blocks: ['IMG:/tmp/a.jpg', 'T:what is this?'] }
    ])
  })

  it('D. PROMPT-FIRST: literal marker turn FOLLOWED by an image-source turn', () => {
    const out = normalizeImageTranscriptMessages([
      user('u1', 'Please preserve [Image #1] literally'),
      user('s1', '[Image: source: /tmp/a.jpg]')
    ])
    // Documents actual behaviour, whatever it is.
    console.log('CASE D =>', JSON.stringify(texts(out)))
    expect(true).toBe(true)
  })

  it('E. literal marker turn, assistant, then a real image upload later in the session', () => {
    const out = normalizeImageTranscriptMessages([
      user('u1', 'talk about [Image #1] please'),
      assistant('a1', 'sure'),
      user('s1', '[Image: source: /tmp/a.jpg]'),
      user('u2', '[Image #1] look')
    ])
    console.log('CASE E =>', JSON.stringify(texts(out)))
    expect(texts(out)[0]).toEqual({ role: 'user', blocks: ['T:talk about [Image #1] please'] })
  })

  it('F. two images, prompt with two markers folds', () => {
    const out = normalizeImageTranscriptMessages([
      user('s1', '[Image: source: /tmp/a.jpg]'),
      user('s2', '[Image: source: /tmp/b.jpg]'),
      user('u1', '[Image #1] [Image #2] compare')
    ])
    console.log('CASE F =>', JSON.stringify(texts(out)))
  })

  it('G. two images, prompt with ONE marker (partial evidence)', () => {
    const out = normalizeImageTranscriptMessages([
      user('s1', '[Image: source: /tmp/a.jpg]'),
      user('s2', '[Image: source: /tmp/b.jpg]'),
      user('u1', '[Image #1] compare')
    ])
    console.log('CASE G =>', JSON.stringify(texts(out)))
  })

  it('H. real image upload where the caption ALSO contains extra literal marker text', () => {
    const out = normalizeImageTranscriptMessages([
      user('s1', '[Image: source: /tmp/a.jpg]'),
      user('u1', '[Image #1] compare with the [Image #2] from before')
    ])
    console.log('CASE H =>', JSON.stringify(texts(out)))
  })
})
