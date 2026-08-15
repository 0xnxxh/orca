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

function imageSourcePathsFromBlocks(blocks: readonly NativeChatBlock[]): string[] | null {
  if (blocks.length === 0) {
    return null
  }
  const paths: string[] = []
  for (const block of blocks) {
    if (!isTextBlock(block)) {
      return null
    }
    const path = imageSourcePathFromText(block.text)
    if (!path) {
      return null
    }
    paths.push(path)
  }
  return paths
}

export function imageSourcePathFromText(text: string): string | null {
  return text.match(IMAGE_SOURCE_MARKER)?.[1]?.trim() ?? null
}

export function isImageSourceUserTurn(message: NativeChatMessage): boolean {
  return message.role === 'user' && imageSourcePathsFromBlocks(message.blocks) !== null
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

function normalizeLiteralNativeChatUserText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

export function nativeChatUserTextMatchText(text: string, hasImages: boolean): string {
  return hasImages ? normalizeNativeChatUserText(text) : normalizeLiteralNativeChatUserText(text)
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
  return nativeChatUserTextMatchText(joined, message.blocks.some(isImageRefBlock)) || null
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

export function nativeChatUserMessageImageEvidenceCount(message: NativeChatMessage): number {
  if (message.role !== 'user') {
    return 0
  }
  const imageRefCount = message.blocks.filter(isImageRefBlock).length
  return Math.max(imageRefCount, countImagePromptMarkers(message))
}

function imageSourceRun(
  messages: readonly NativeChatMessage[],
  start: number,
  source: NativeChatMessage['source']
): { end: number; paths: string[] } {
  const paths: string[] = []
  let end = start
  while (end < messages.length) {
    const candidate = messages[end]!
    const candidatePaths = imageSourcePathsFromBlocks(candidate.blocks)
    if (candidate.role !== 'user' || candidate.source !== source || !candidatePaths) {
      break
    }
    paths.push(...candidatePaths)
    end += 1
  }
  return { end, paths }
}

function mergedImagePrompt(
  prompt: NativeChatMessage,
  imagePaths: readonly string[]
): NativeChatMessage {
  return {
    ...prompt,
    blocks: [
      ...imagePaths.map((path) => ({ type: 'image-ref' as const, path })),
      ...stripImagePromptMarkersFromTextBlocks(prompt.blocks)
    ]
  }
}

/** Claude records adjacent image-source and marker-bearing prompt turns in
 *  either order. Fold only a one-marker-per-source pair so partial evidence
 *  cannot make one landed row claim more attached images than it proves. */
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
    const imagePaths = imageSourcePathsFromBlocks(message.blocks)
    const markerCount = countImagePromptMarkers(message)
    if (!imagePaths && markerCount > 0) {
      const sources = imageSourceRun(messages, index + 1, message.source)
      if (sources.paths.length === markerCount) {
        normalized ??= messages.slice(0, index)
        normalized.push(mergedImagePrompt(message, sources.paths))
        index = sources.end - 1
        continue
      }
    }
    if (imagePaths) {
      normalized ??= messages.slice(0, index)
      const sources = imageSourceRun(messages, index, message.source)
      const prompt = messages[sources.end]
      if (
        prompt?.role === 'user' &&
        prompt.source === message.source &&
        countImagePromptMarkers(prompt) === sources.paths.length
      ) {
        normalized.push(mergedImagePrompt(prompt, sources.paths))
        index = sources.end
        continue
      }
      for (let sourceIndex = index; sourceIndex < sources.end; sourceIndex += 1) {
        const sourceMessage = messages[sourceIndex]!
        const sourcePaths = imageSourcePathsFromBlocks(sourceMessage.blocks)!
        normalized.push({
          ...sourceMessage,
          blocks: sourcePaths.map((path) => ({ type: 'image-ref', path }))
        })
      }
      index = sources.end - 1
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
