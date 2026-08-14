import {
  isImageRefBlock,
  isTextBlock,
  type NativeChatBlock,
  type NativeChatMessage
} from './native-chat-types'

const IMAGE_SOURCE_MARKER = /^\[Image:\s*source:\s*(.+?)\]\s*$/
const IMAGE_PROMPT_MARKER = /\[Image #\d+\]/
const IMAGE_PROMPT_MARKERS = /\[Image #\d+\]/g
const IMAGE_PROMPT_MARKER_AT_START = /^[^\S\r\n]*\[Image #\d+\]/
const IMAGE_PROMPT_MARKER_AT_END = /\[Image #\d+\][^\S\r\n]*$/
const HORIZONTAL_WHITESPACE_START = /^[^\S\r\n]+/
const HORIZONTAL_WHITESPACE_END = /[^\S\r\n]+$/

function soleText(message: NativeChatMessage): string | null {
  return message.blocks.length === 1 && isTextBlock(message.blocks[0])
    ? message.blocks[0].text
    : null
}

export function imageSourcePathFromText(text: string): string | null {
  return text.match(IMAGE_SOURCE_MARKER)?.[1]?.trim() ?? null
}

export function isImageSourceUserTurn(message: NativeChatMessage): boolean {
  return message.role === 'user' && imageSourcePathFromText(soleText(message) ?? '') !== null
}

export function stripImagePromptMarker(text: string): string {
  const stripped = text.replace(IMAGE_PROMPT_MARKERS, '')
  if (stripped === text) {
    return text
  }
  let result = IMAGE_PROMPT_MARKER_AT_START.test(text)
    ? stripped.replace(HORIZONTAL_WHITESPACE_START, '')
    : stripped
  if (IMAGE_PROMPT_MARKER_AT_END.test(text)) {
    result = result.replace(HORIZONTAL_WHITESPACE_END, '')
  }
  return result
}

export function normalizeNativeChatUserText(text: string): string {
  return stripImagePromptMarker(text).trim().replace(/\s+/g, ' ')
}

/** Marker text that stripping would erase entirely is text the user typed
 *  literally — a real marker always rides on an image turn, which normalization
 *  has already folded away by the time echo matching runs. */
export function normalizeNativeChatUserTextWithLiteralFallback(text: string): string {
  return normalizeNativeChatUserText(text) || text.trim().replace(/\s+/g, ' ')
}

function joinedUserText(message: NativeChatMessage): string {
  return message.blocks
    .filter(isTextBlock)
    .map((block) => block.text)
    .join(' ')
}

export function normalizedNativeChatUserMessageText(message: NativeChatMessage): string | null {
  if (message.role !== 'user') {
    return null
  }
  return normalizeNativeChatUserText(joinedUserText(message)) || null
}

/** The text an optimistic echo matches a landed turn on. Keeps literal marker
 *  text keyable so the pending path and the render path agree about which
 *  `[Image #n]` runs are the user's own words. */
export function nativeChatUserMessageMatchText(message: NativeChatMessage): string | null {
  if (message.role !== 'user') {
    return null
  }
  const joined = joinedUserText(message)
  const normalized = normalizeNativeChatUserText(joined)
  if (normalized || message.blocks.some(isImageRefBlock)) {
    return normalized || null
  }
  return normalizeNativeChatUserTextWithLiteralFallback(joined) || null
}

function stripImagePromptMarkersFromTextBlocks(
  blocks: readonly NativeChatBlock[]
): NativeChatBlock[] {
  let sawText = false
  let next: NativeChatBlock[] | null = null
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!
    if (!isTextBlock(block)) {
      next?.push(block)
      continue
    }
    const isFirstText = !sawText
    sawText = true
    const text = stripImagePromptMarker(block.text)
    if (!text.trim() && (text !== block.text || isFirstText)) {
      next ??= blocks.slice(0, index)
      continue
    }
    if (text !== block.text) {
      next ??= blocks.slice(0, index)
      next.push({ ...block, text })
      continue
    }
    next?.push(block)
  }
  return next ?? (blocks as NativeChatBlock[])
}

function removeEmptyFirstTextBlock(blocks: readonly NativeChatBlock[]): NativeChatBlock[] {
  const index = blocks.findIndex(isTextBlock)
  const block = blocks[index]
  if (index === -1 || !block || !isTextBlock(block) || block.text.trim()) {
    return blocks as NativeChatBlock[]
  }
  return [...blocks.slice(0, index), ...blocks.slice(index + 1)]
}

export function hasImagePromptMarker(message: NativeChatMessage): boolean {
  return message.blocks.some((block) => isTextBlock(block) && IMAGE_PROMPT_MARKER.test(block.text))
}

/** Markers carried by a turn. One marker vouches for one image, so a send of N
 *  images is only echoed by a turn bearing N of them. */
export function countImagePromptMarkers(message: NativeChatMessage): number {
  return message.blocks.reduce(
    (count, block) =>
      count + (isTextBlock(block) ? (block.text.match(IMAGE_PROMPT_MARKERS)?.length ?? 0) : 0),
    0
  )
}

/** Claude records image paths as source turns followed by a prompt carrying
 *  image markers. Merge the whole run back into one native user turn. */
export function normalizeImageTranscriptMessages(
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
        hasImagePromptMarker(prompt)
      ) {
        normalized.push({
          ...prompt,
          blocks: [
            ...imagePaths.map((path) => ({ type: 'image-ref' as const, path })),
            ...stripImagePromptMarkersFromTextBlocks(prompt.blocks)
          ]
        })
        index = nextIndex
        continue
      }
      normalized.push({
        ...message,
        blocks: [{ type: 'image-ref', path: imagePath }]
      })
      continue
    }
    const blocks = removeEmptyFirstTextBlock(message.blocks)
    if (blocks === message.blocks) {
      normalized?.push(message)
    } else {
      normalized ??= messages.slice(0, index)
      normalized.push({ ...message, blocks })
    }
  }
  return normalized ?? (messages as NativeChatMessage[])
}
