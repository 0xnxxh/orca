import { describe, expect, it } from 'vitest'
import {
  MOBILE_NATIVE_CHAT_TEXT_CHUNK_CHARS,
  splitMobileNativeChatLongText
} from './mobile-native-chat-long-text'

describe('splitMobileNativeChatLongText', () => {
  it('bounds render nodes while preserving the exact full text', () => {
    const text = Array.from(
      { length: 1800 },
      (_, index) => `Paragraph ${index}: readable prose.`
    ).join('\n\n')
    const chunks = splitMobileNativeChatLongText(text)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= MOBILE_NATIVE_CHAT_TEXT_CHUNK_CHARS)).toBe(true)
    expect(chunks.join('')).toBe(text)
  })

  it('does not split surrogate pairs at a hard boundary', () => {
    const text = `${'a'.repeat(MOBILE_NATIVE_CHAT_TEXT_CHUNK_CHARS - 1)}😀tail`
    const chunks = splitMobileNativeChatLongText(text)

    expect(chunks.join('')).toBe(text)
    expect(chunks[0]?.endsWith('\ud83d')).toBe(false)
    expect(chunks[1]?.startsWith('\ude00')).toBe(false)
  })
})
