import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

/** Decides whether the live streaming preview should render as a synthetic
 *  bubble. Text alone can't tell "the transcript caught up with this stream"
 *  from "a new reply happens to repeat the previous turn's prefix" — the old
 *  prefix test swallowed genuine repeated-prefix replies. The gate keeps the
 *  transcript tail observed when the current stream segment began: the bubble
 *  hides only when the tail MOVED during the segment and leads with the
 *  streamed text (the real turn landed), never for an older identical turn. */
export type MobileNativeChatStreamingGate = {
  /** Streamed text seen on the previous tick ('' while idle). */
  prevText: string
  /** Folded tail message id when the current segment began; null while the
   *  gate has never observed an idle tick (mounted mid-stream), where the
   *  legacy suppress-on-prefix rule applies. */
  baselineTailId: string | null
}

export function createMobileNativeChatStreamingGate(): MobileNativeChatStreamingGate {
  return { prevText: '', baselineTailId: null }
}

function assistantTailText(tail: NativeChatMessage | undefined): string {
  if (!tail || tail.role !== 'assistant') {
    return ''
  }
  return tail.blocks
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim()
}

// Reuses the incoming gate object when nothing moved, so a caller can detect
// "no change" by reference (and a render-time state adjustment can settle).
function advanceGate(
  gate: MobileNativeChatStreamingGate,
  prevText: string,
  baselineTailId: string | null
): MobileNativeChatStreamingGate {
  return gate.prevText === prevText && gate.baselineTailId === baselineTailId
    ? gate
    : { prevText, baselineTailId }
}

/** Advance the gate one tick and derive the visible streaming text (null hides
 *  the bubble). Pure and idempotent for a repeated (text, tail) pair, so a
 *  re-render without new data cannot flip the decision. */
export function deriveMobileNativeChatStreaming(
  gate: MobileNativeChatStreamingGate,
  folded: readonly NativeChatMessage[],
  streamingText: string | undefined
): { gate: MobileNativeChatStreamingGate; streaming: string | null } {
  const text = streamingText?.trim() ?? ''
  const tail = folded.at(-1)
  const tailId = tail?.id ?? null
  if (!text) {
    // Idle: keep anchoring the baseline to the live tail so the next segment
    // knows which tail predates it.
    return { gate: advanceGate(gate, '', tailId), streaming: null }
  }
  // A stream that is not an extension of the previous tick is a new segment
  // (next reply part); re-anchor to the tail that predates it.
  const segmentStart = gate.prevText !== '' && !text.startsWith(gate.prevText)
  const baselineTailId = segmentStart ? tailId : gate.baselineTailId
  const tailText = assistantTailText(tail)
  const tailLeadsWithStream = tailText.startsWith(text)
  // baselineTailId === null: mounted mid-stream with no pre-stream observation —
  // fall back to suppress-on-prefix (a duplicate bubble is worse than briefly
  // hiding an improbable mount-coincident repeated reply).
  const caughtUp = tailLeadsWithStream && (baselineTailId === null || tailId !== baselineTailId)
  return {
    gate: advanceGate(gate, text, baselineTailId),
    streaming: caughtUp ? null : text
  }
}
