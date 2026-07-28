// Choosing how a chat send lands when the agent's TUI input line still holds a
// launch-context draft that Orca itself injected.
//
// The point of the plan: Orca INJECTED that text, so when the input line still
// holds exactly what was injected, the buffer already IS the message. The send
// is then just the submit key — no clear, no paste, nothing that can
// concatenate, and multi-line submits as one turn with no buffer surgery.

import { buildAgentTuiClearInputForText } from '../../../../shared/agent-tui-input-clear'
import { stripScrollbackAnsi } from './native-chat-scrape-fallback'

export type NativeChatLaunchDraftSendPlan =
  /** Input line already holds exactly this text — press Enter and nothing else. */
  | { kind: 'submit-in-place' }
  /** Input line holds a stale injected draft — replace it, clearing every line. */
  | { kind: 'replace-draft'; clearInput: string; seededText: string }
  /** No injected draft is parked on the line; keep the ordinary send path. */
  | { kind: 'default' }

/** Prompt glyphs both supported agent TUIs draw at the start of the input line. */
const COMPOSER_PROMPT_LINE = /^\s*[❯›]\s?/

/**
 * A short prefix of the draft's first line. Deliberately SHORT: the input line
 * wraps long text, and a fingerprint spanning a wrap would go unmatched — so a
 * long one would report "gone" for a draft that is still sitting there.
 */
const DRAFT_FINGERPRINT_LENGTH = 12

function seededDraftFingerprint(seededText: string): string {
  const firstLine = seededText.split(/\r\n|\r|\n/).find((line) => line.trim() !== '') ?? ''
  return firstLine.trim().slice(0, DRAFT_FINGERPRINT_LENGTH)
}

/**
 * Whether the agent's rendered input line still shows the injected draft.
 * `null` means it could not be observed at all (no screen, no locatable prompt
 * line, no usable fingerprint) — callers must treat that as "unknown" and pick
 * whichever branch is safe when wrong, never as evidence either way.
 *
 * Both TUIs redraw their placeholder once the buffer is genuinely empty, so a
 * `false` here is a real observation rather than an assumption that a write landed.
 */
export function agentInputLineShowsSeededDraft(
  screen: string | null | undefined,
  seededText: string
): boolean | null {
  if (!screen) {
    return null
  }
  const fingerprint = seededDraftFingerprint(seededText)
  if (fingerprint === '') {
    return null
  }
  const lines = stripScrollbackAnsi(screen).split('\n')
  let promptIndex = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (COMPOSER_PROMPT_LINE.test(lines[index]!)) {
      promptIndex = index
      break
    }
  }
  if (promptIndex < 0) {
    return null
  }
  // Only the input line downward: the same text sitting in the transcript above
  // is a sent turn, not residue, and must not be read as a still-parked draft.
  return lines.slice(promptIndex).join('\n').includes(fingerprint)
}

/**
 * Submitting in place is only safe on POSITIVE evidence that the draft is still
 * on the input line. The user may have cleared or edited that line directly in
 * terminal view while the composer copy lived on, and pressing Enter on a buffer
 * that no longer holds the draft would submit the wrong thing (or nothing at
 * all) and silently lose the message. Anything short of "yes, it is still there"
 * falls through to replace-draft, which is correct in every state.
 */
export function planNativeChatLaunchDraftSend(args: {
  /** Text Orca injected into the TUI line, or null when nothing is parked there. */
  seededText: string | null | undefined
  text: string
  hasImages: boolean
  readScreen: () => string | null | undefined
}): NativeChatLaunchDraftSendPlan {
  const seededText = args.seededText
  if (!seededText || seededText.trim() === '') {
    return { kind: 'default' }
  }
  // Images must be pasted, so they can never submit in place — but they still
  // need the multi-line clear, since the image path's own single Ctrl+U would
  // leave every earlier line of the draft to glue onto the message.
  if (
    !args.hasImages &&
    args.text === seededText &&
    agentInputLineShowsSeededDraft(args.readScreen(), seededText) === true
  ) {
    return { kind: 'submit-in-place' }
  }
  return {
    kind: 'replace-draft',
    clearInput: buildAgentTuiClearInputForText(seededText),
    seededText
  }
}

/**
 * Did the clear empty the input line? Only a positive observation that the draft
 * is GONE counts; unknown stays uncleared so the caller widens to a maximal
 * burst. A wasted burst is harmless (measured), a missed one concatenates.
 */
export function agentInputLineClearedSeededDraft(
  screen: string | null | undefined,
  seededText: string
): boolean {
  return agentInputLineShowsSeededDraft(screen, seededText) === false
}

/** What a composer send needs: which path to take, and the clear/confirm bytes
 *  the ordinary send paths should use when it is a draft replacement. */
export function resolveNativeChatLaunchDraftSend(args: {
  launchDraft: { agent: string; text: string } | null | undefined
  launchDraftResolved: boolean
  agent: string
  text: string
  hasImages: boolean
  readScreen: () => string | null | undefined
}): {
  plan: NativeChatLaunchDraftSendPlan
  sendOptions: { clearInput: string; confirmCleared: () => boolean } | undefined
} {
  const { launchDraft, launchDraftResolved, agent, readScreen } = args
  // A resolved draft was already submitted or cleared TUI-side, so nothing of
  // ours is on the line any more — treating it as parked would clear or submit
  // a buffer that no longer holds it.
  const seededText =
    launchDraft && launchDraft.agent === agent && !launchDraftResolved ? launchDraft.text : null
  const plan = planNativeChatLaunchDraftSend({
    seededText,
    text: args.text,
    hasImages: args.hasImages,
    readScreen
  })
  if (plan.kind !== 'replace-draft') {
    return { plan, sendOptions: undefined }
  }
  return {
    plan,
    sendOptions: {
      clearInput: plan.clearInput,
      confirmCleared: () => agentInputLineClearedSeededDraft(readScreen(), plan.seededText)
    }
  }
}
