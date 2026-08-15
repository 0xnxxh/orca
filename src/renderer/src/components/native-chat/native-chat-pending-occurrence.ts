import {
  nativeChatUserMessageImageEvidenceCount,
  nativeChatUserMessageMatchText,
  nativeChatUserTextMatchText,
  normalizeNativeChatUserText,
  normalizedNativeChatUserMessageText
} from '../../../../shared/native-chat-image-transcript-markers'
import { isImageRefBlock, type NativeChatMessage } from '../../../../shared/native-chat-types'

export type NativeChatPendingOccurrence = {
  text: string
  imagePaths?: readonly string[]
  sentAt: number
  afterMessageId?: string | null
  afterMessageTimestamp?: number | null
  matchingOccurrence?: number
  matchingAfterTimestamp?: number
}

export function normalizeNativeChatPendingText(text: string): string {
  return normalizeNativeChatUserText(text)
}

/** Message-side rule (`nativeChatUserMessageMatchText`) applied to a send: only
 *  a send that actually carried images can own an `[Image #n]` marker, so on
 *  every other send the marker is literal text and has to key verbatim. */
function nativeChatPendingMatchText(
  pending: Pick<NativeChatPendingOccurrence, 'text' | 'imagePaths'>
): string {
  return nativeChatUserTextMatchText(pending.text, Boolean(pending.imagePaths?.some(Boolean)))
}

function nativeChatTextContentKey(text: string, imageCount: number): string {
  return imageCount > 0 ? `text:${text}\0images:${imageCount}` : `text:${text}`
}

export function nativeChatPendingContentKey(
  pending: Pick<NativeChatPendingOccurrence, 'text' | 'imagePaths'>
): string {
  const text = nativeChatPendingMatchText(pending)
  const imagePaths = pending.imagePaths?.filter(Boolean) ?? []
  if (text) {
    return nativeChatTextContentKey(text, imagePaths.length)
  }
  return imagePaths.length > 0 ? `images:${JSON.stringify(imagePaths)}` : 'empty'
}

function nativeChatUserMessageContentKeys(message: NativeChatMessage): readonly string[] {
  if (message.role !== 'user') {
    return []
  }
  const keys = new Set<string>()
  const matchText = nativeChatUserMessageMatchText(message) ?? ''
  if (matchText) {
    keys.add(nativeChatTextContentKey(matchText, 0))
  }
  const imageCount = nativeChatUserMessageImageEvidenceCount(message)
  const imageText = normalizedNativeChatUserMessageText(message)
  if (imageText && imageCount > 0) {
    keys.add(nativeChatTextContentKey(imageText, imageCount))
  } else if (imageCount > 0) {
    const imagePaths = message.blocks
      .filter(isImageRefBlock)
      .map((block) => block.path)
      .filter((path): path is string => Boolean(path))
    if (imagePaths.length > 0) {
      keys.add(`images:${JSON.stringify(imagePaths)}`)
    }
  }
  return [...keys]
}

export function matchingNativeChatUserContentCounts(
  messages: readonly NativeChatMessage[]
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    for (const key of nativeChatUserMessageContentKeys(message)) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

export function advancedNativeChatUserContentCounts(
  messages: readonly NativeChatMessage[]
): Map<string, number> {
  const advanced = new Map<string, number>()
  const waiting = new Map<string, number>()
  for (const message of messages) {
    if (message.role === 'user') {
      for (const key of nativeChatUserMessageContentKeys(message)) {
        waiting.set(key, (waiting.get(key) ?? 0) + 1)
      }
      continue
    }
    for (const [key, count] of waiting) {
      advanced.set(key, (advanced.get(key) ?? 0) + count)
    }
    waiting.clear()
  }
  return advanced
}

/** User texts that already have a later non-user turn (ready to prune echoes). */
export function advancedNativeChatUserTexts(
  messages: readonly NativeChatMessage[]
): readonly string[] {
  const advanced: string[] = []
  const waiting: string[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      const text = nativeChatUserMessageMatchText(message)
      if (text) {
        waiting.push(text)
      }
      continue
    }
    advanced.push(...waiting)
    waiting.length = 0
  }
  return advanced
}

/** All user texts (for hiding optimistic echoes once the turn exists). */
export function matchingNativeChatUserTexts(
  messages: readonly NativeChatMessage[]
): readonly string[] {
  const texts: string[] = []
  for (const message of messages) {
    const text = nativeChatUserMessageMatchText(message)
    if (text) {
      texts.push(text)
    }
  }
  return texts
}

/**
 * How many leading pending texts concatenate to exactly `userText`, allowing at
 * most one collapsed space at each send boundary. Covers rapid-send glue
 * ("joke"+"continue" → "joke continue") while still requiring the whole row to
 * be consumed, so unrelated prefixes never match ("hi" ↛ "history").
 *
 * Greedy is exact here: both sides are whitespace-normalized, so a piece never
 * starts with a space and at most one of the two boundary forms can apply.
 */
export function countLeadingPendingTextsGluedToUserText(
  pendingTexts: readonly string[],
  userText: string
): number {
  if (pendingTexts.length === 0 || userText.length === 0) {
    return 0
  }
  let cursor = 0
  for (let index = 0; index < pendingTexts.length; index += 1) {
    const piece = pendingTexts[index]
    if (!piece) {
      return 0
    }
    if (userText.startsWith(piece, cursor)) {
      cursor += piece.length
    } else if (index > 0 && userText.startsWith(` ${piece}`, cursor)) {
      cursor += piece.length + 1
    } else {
      return 0
    }
    if (cursor === userText.length) {
      return index + 1
    }
  }
  return 0
}

/**
 * Mark pending entries represented only by multi-send glue (2+ consecutive
 * optimistic texts concatenated into one transcript user row). Exact single
 * matches stay in the content-key/occurrence path so repeated prompts and
 * send boundaries keep their existing semantics.
 *
 * `userTexts` must already be filtered to rows after the oldest entry's send
 * boundary — this matcher has no clock of its own.
 */
export function selectPendingIndicesRepresentedByUserTexts(
  pending: readonly NativeChatPendingOccurrence[],
  userTexts: readonly string[]
): Set<number> {
  const represented = new Set<number>()
  if (pending.length < 2 || userTexts.length === 0) {
    return represented
  }
  const remaining = pending.map((entry, index) => ({
    index,
    text: nativeChatPendingMatchText(entry),
    hasImages: Boolean(entry.imagePaths?.some(Boolean))
  }))
  for (const userText of userTexts) {
    const open = remaining.filter(
      (entry) => !entry.hasImages && !represented.has(entry.index) && entry.text.length > 0
    )
    const gluedCount = countLeadingPendingTextsGluedToUserText(
      open.map((entry) => entry.text),
      userText
    )
    // Why: gluedCount === 1 is an exact match — leave it to occurrence counting.
    if (gluedCount < 2) {
      continue
    }
    for (let i = 0; i < gluedCount; i += 1) {
      const entry = open[i]
      if (!entry) {
        continue
      }
      represented.add(entry.index)
      const at = remaining.findIndex((candidate) => candidate.index === entry.index)
      if (at !== -1) {
        remaining.splice(at, 1)
      }
    }
  }
  return represented
}

export function nativeChatPendingMatchKey(pending: NativeChatPendingOccurrence): string {
  return `${String(pending.afterMessageId)}\0${nativeChatPendingContentKey(pending)}`
}

export function assignNativeChatPendingOccurrence<T extends NativeChatPendingOccurrence>(
  existing: readonly T[],
  entry: T
): T {
  const key = nativeChatPendingMatchKey(entry)
  const matching = existing.filter((candidate) => nativeChatPendingMatchKey(candidate) === key)
  if (matching.length === 0) {
    return entry
  }
  const previousOccurrence = Math.max(
    ...matching.map((candidate, index) => candidate.matchingOccurrence ?? index + 1)
  )
  const first = matching[0]
  // Why: pruning an earlier echo must not let a later identical send reuse the
  // same transcript occurrence, even after the read pages out its boundary.
  return {
    ...entry,
    matchingOccurrence: previousOccurrence + 1,
    matchingAfterTimestamp:
      first?.matchingAfterTimestamp ?? first?.afterMessageTimestamp ?? first?.sentAt
  }
}

export function nativeChatPendingMatchingAfter(pending: NativeChatPendingOccurrence): number {
  return pending.matchingAfterTimestamp ?? pending.afterMessageTimestamp ?? pending.sentAt
}

export function nativeChatPendingOccurrence(
  pending: NativeChatPendingOccurrence,
  alreadyConsumed: number
): number {
  return pending.matchingOccurrence ?? alreadyConsumed + 1
}
