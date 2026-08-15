import { normalizeLegacyNativeChatImageTranscriptMessages } from './native-chat-legacy-image-transcript'
import type { NativeChatMessage } from './native-chat-types'
import { NATIVE_CHAT_IMAGE_SOURCE_RUNTIME_CAPABILITY } from './protocol-version'

export function normalizeNativeChatImageSourceWireMessages(
  messages: readonly NativeChatMessage[],
  negotiatedCapability: unknown
): NativeChatMessage[] {
  return negotiatedCapability === NATIVE_CHAT_IMAGE_SOURCE_RUNTIME_CAPABILITY
    ? (messages as NativeChatMessage[])
    : normalizeLegacyNativeChatImageTranscriptMessages(messages)
}
