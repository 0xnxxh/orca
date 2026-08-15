import { imageSourcePathFromText } from './native-chat-image-transcript-markers'
import { isTextBlock, type NativeChatBlock, type NativeChatMessage } from './native-chat-types'

// COMPAT(v1.4.183): released peers only recognized marker runs at the start of
// the first text block and folded source rows that preceded that prompt.
const LEGACY_IMAGE_PROMPT_MARKERS = /^(?:\[Image #\d+\]\s*)+/

function soleText(message: NativeChatMessage): string | null {
  return message.blocks.length === 1 && isTextBlock(message.blocks[0])
    ? message.blocks[0].text
    : null
}

function stripLegacyImagePromptMarkersFromFirstText(
  blocks: readonly NativeChatBlock[]
): NativeChatBlock[] {
  const textIndex = blocks.findIndex(isTextBlock)
  const block = blocks[textIndex]
  if (textIndex === -1 || !block || !isTextBlock(block)) {
    return blocks as NativeChatBlock[]
  }
  const text = block.text.replace(LEGACY_IMAGE_PROMPT_MARKERS, '')
  if (!text.trim()) {
    return blocks.filter((_, index) => index !== textIndex)
  }
  if (text === block.text) {
    return blocks as NativeChatBlock[]
  }
  const next = [...blocks]
  next[textIndex] = { ...block, text }
  return next
}

function legacyImagePromptMarkerStartsMessage(message: NativeChatMessage): boolean {
  const firstText = message.blocks.find(isTextBlock)
  return firstText ? LEGACY_IMAGE_PROMPT_MARKERS.test(firstText.text) : false
}

/** Exact v1.4.183 image-marker contract for a current client paired to a host
 *  that did not negotiate native image-source publication. */
export function normalizeLegacyNativeChatImageTranscriptMessages(
  messages: readonly NativeChatMessage[]
): NativeChatMessage[] {
  let normalized: NativeChatMessage[] | null = null
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    if (message.role !== 'user') {
      normalized?.push(message)
      continue
    }
    const imagePath = imageSourcePathFromText(soleText(message) ?? '')
    if (imagePath) {
      normalized ??= messages.slice(0, index)
      const imagePaths = [imagePath]
      let nextIndex = index + 1
      while (nextIndex < messages.length) {
        const candidate = messages[nextIndex]!
        const candidatePath = imageSourcePathFromText(soleText(candidate) ?? '')
        if (candidate.role !== 'user' || candidate.source !== message.source || !candidatePath) {
          break
        }
        imagePaths.push(candidatePath)
        nextIndex += 1
      }
      const prompt = messages[nextIndex]
      if (
        prompt?.role === 'user' &&
        prompt.source === message.source &&
        legacyImagePromptMarkerStartsMessage(prompt)
      ) {
        normalized.push({
          ...prompt,
          blocks: [
            ...imagePaths.map((path) => ({ type: 'image-ref' as const, path })),
            ...stripLegacyImagePromptMarkersFromFirstText(prompt.blocks)
          ]
        })
        index = nextIndex
        continue
      }
      normalized.push({ ...message, blocks: [{ type: 'image-ref', path: imagePath }] })
      continue
    }
    const blocks = stripLegacyImagePromptMarkersFromFirstText(message.blocks)
    if (blocks === message.blocks) {
      normalized?.push(message)
    } else {
      normalized ??= messages.slice(0, index)
      normalized.push({ ...message, blocks })
    }
  }
  return normalized ?? (messages as NativeChatMessage[])
}
