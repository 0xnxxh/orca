import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  countImageSourceTurnsAfter,
  normalizeReconcileText,
  normalizedUserText
} from './mobile-native-chat-draft-reconcile'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

const SPACE = ' '

/** A normalized user turn plus its transcript position, which bounds glue. */
type UserTurn = { index: number; text: string }

/**
 * Ids retired by a single transcript turn that glued several rapid sends into
 * one row (the host writes a send's body and its Enter ~500ms apart, so a second
 * body can land on the same TUI input line before the first submits).
 *
 * Bounded to turns strictly AFTER each send's captured tail. Without that bound
 * an older turn that happens to read like the concatenation retires a newer
 * send, and a message the user really queued silently never renders.
 */
export function selectGluedPendingIds(
  messages: readonly NativeChatMessage[],
  pending: readonly MobileNativeChatPendingMessage[]
): ReadonlySet<string> {
  const retired = new Set<string>()
  if (pending.length < 2) {
    return retired
  }
  const messageIndexById = new Map<string, number>()
  const turns: UserTurn[] = []
  for (const [index, message] of messages.entries()) {
    messageIndexById.set(message.id, index)
    const text = normalizedUserText(message)
    if (text) {
      turns.push({ index, text })
    }
  }
  // Image echoes carry no caption to concatenate; an unresolvable tail leaves the
  // send unbounded. Either way the item can only end a run, never join one.
  const segments = pending.map((item) => normalizeReconcileText(item.text))
  const tails = pending.map((item) =>
    item.baselineTailMessageId === null
      ? -1
      : (messageIndexById.get(item.baselineTailMessageId) ?? null)
  )

  let cursor = 0
  for (const turn of turns) {
    if (cursor >= pending.length - 1) {
      break
    }
    for (let start = cursor; start < pending.length - 1; start++) {
      const matched = matchGluedRun(turn, segments, tails, start)
      if (matched === 0) {
        continue
      }
      for (let index = start; index < start + matched; index++) {
        retired.add(pending[index]!.id)
      }
      cursor = start + matched
      break
    }
  }
  return retired
}

/**
 * Length of the pending run starting at `start` that exactly spells out `turn`,
 * or 0 when there is none. Greedy is provably equivalent to backtracking here:
 * both sides are whitespace-normalized, so a segment can never begin with the
 * optional single-space separator and consuming it is forced.
 */
function matchGluedRun(
  turn: UserTurn,
  segments: readonly string[],
  tails: readonly (number | null)[],
  start: number
): number {
  let at = 0
  let matched = 0
  for (let index = start; index < segments.length; index++) {
    const segment = segments[index]!
    const tail = tails[index]
    if (segment === '' || tail === null || turn.index <= tail) {
      return 0
    }
    if (at > 0 && turn.text[at] === SPACE) {
      at += 1
    }
    if (!turn.text.startsWith(segment, at)) {
      return 0
    }
    at += segment.length
    matched += 1
    if (at === turn.text.length) {
      // A lone exact match is an ordinary landing, which the count pass owns.
      return matched > 1 ? matched : 0
    }
  }
  return 0
}

/** Pending echoes that survive this transcript: exact-text landings retire by
 *  ordinal, and whatever is left gets one bounded pass for a glued row. */
export function retireLandedMobileNativeChatPending(
  messages: readonly NativeChatMessage[],
  current: readonly MobileNativeChatPendingMessage[],
  landedImagePendingIds: ReadonlySet<string>
): MobileNativeChatPendingMessage[] {
  const landedCounts = new Map<string, number>()
  for (const message of messages) {
    const text = normalizedUserText(message)
    if (text) {
      landedCounts.set(text, (landedCounts.get(text) ?? 0) + 1)
    }
  }
  // Image-only source-turn counts stay stable across reruns and ignore paginated history.
  const survivors = current.filter((item) => {
    if (landedImagePendingIds.has(item.id)) {
      return false
    }
    // Keep image echoes until their local preview reaches the authoritative message.
    if (item.images?.length) {
      return true
    }
    return item.text.trim() === ''
      ? countImageSourceTurnsAfter(messages, item.baselineTailMessageId) < item.expectedOccurrence
      : (landedCounts.get(normalizeReconcileText(item.text)) ?? 0) < item.expectedOccurrence
  })
  const glued = selectGluedPendingIds(messages, survivors)
  return glued.size === 0 ? survivors : survivors.filter((item) => !glued.has(item.id))
}
