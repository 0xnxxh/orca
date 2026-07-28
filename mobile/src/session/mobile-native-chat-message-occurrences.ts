import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

export function normalizedMobileNativeChatUserText(message: NativeChatMessage): string | null {
  if (message.role !== 'user') {
    return null
  }
  const text = message.blocks
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim()
  return text || null
}

export function countMobileNativeChatUserTextOccurrences(
  messages: readonly NativeChatMessage[],
  text: string
): number {
  let count = 0
  for (const message of messages) {
    if (normalizedMobileNativeChatUserText(message) === text) {
      count++
    }
  }
  return count
}
