import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizedUserText } from './mobile-native-chat-draft-reconcile'

/**
 * Adopting the host's launch-context prefill as the mobile composer draft, and
 * retiring it again once it is resolved elsewhere. Split out of the drafts hook
 * so the general draft/pending accounting stays separate from this one concern.
 */
export function useMobileNativeChatLaunchDraftSeed(args: {
  draftKey: string | null
  messages: readonly NativeChatMessage[]
  /** Host-provided launch context still parked as an unsent TUI-input draft. */
  launchDraft?: string | null
  chatActive: boolean
  transcriptLoading?: boolean
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>
}): {
  /** Text still believed to be parked on the agent's TUI input line, or null
   *  once declined or retired. Send paths size their pre-clear from it, since
   *  one Ctrl+U clears only one logical line. */
  readSeededLaunchDraft: () => string | null
} {
  const { draftKey, messages, launchDraft, chatActive, transcriptLoading, setDrafts } = args

  // Seeded launch-context text per tab; '' marks a permanent decline so a
  // cleared composer never resurrects the prefill.
  const seededLaunchDraftByKeyRef = useRef(new Map<string, string>())

  // Why: launch context delivered as a TUI-input prefill is invisible in chat;
  // adopt it once as the composer draft so mobile shows the same context.
  useEffect(() => {
    if (
      !draftKey ||
      !chatActive ||
      !launchDraft?.trim() ||
      seededLaunchDraftByKeyRef.current.has(draftKey)
    ) {
      return
    }
    // Why: `session.tabs` carries launchDraft before the transcript read settles,
    // and an empty (or previous tab's) list would let the decline below misjudge
    // an already-submitted prefill — long enough for a send to duplicate it.
    if (transcriptLoading) {
      return
    }
    // A user turn already in the transcript means the TUI prefill was submitted
    // or deliberately cleared; decline instead of resurrecting it.
    if (messages.some((message) => normalizedUserText(message) !== null)) {
      seededLaunchDraftByKeyRef.current.set(draftKey, '')
      return
    }
    seededLaunchDraftByKeyRef.current.set(draftKey, launchDraft)
    setDrafts((previous) =>
      (previous[draftKey] ?? '') === '' ? { ...previous, [draftKey]: launchDraft } : previous
    )
  }, [chatActive, draftKey, launchDraft, messages, setDrafts, transcriptLoading])

  // Drop an untouched adopted copy once the prefill is resolved elsewhere — a
  // user turn landed (sent or cleared TUI-side) or the host stopped publishing
  // it (desktop sent or reconciled it). User edits are always kept.
  useEffect(() => {
    // Same gates as the seed: off-chat there is no retraction to read (the tab
    // publishes no draft to us), and an untrusted transcript would wipe an
    // untouched copy on the strength of another tab's user turns.
    if (!draftKey || !chatActive || transcriptLoading) {
      return
    }
    const seeded = seededLaunchDraftByKeyRef.current.get(draftKey)
    if (!seeded) {
      return
    }
    const hasUserTurn = messages.some((message) => normalizedUserText(message) !== null)
    if (!hasUserTurn && launchDraft?.trim()) {
      return
    }
    seededLaunchDraftByKeyRef.current.set(draftKey, '')
    setDrafts((previous) =>
      (previous[draftKey] ?? '') === seeded ? { ...previous, [draftKey]: '' } : previous
    )
  }, [chatActive, draftKey, launchDraft, messages, setDrafts, transcriptLoading])

  // '' in the map is a permanent decline, not a parked draft — both mean there is
  // nothing of ours on the TUI line, so both read as null.
  const readSeededLaunchDraft = useCallback(
    () => (draftKey ? seededLaunchDraftByKeyRef.current.get(draftKey) || null : null),
    [draftKey]
  )

  return { readSeededLaunchDraft }
}
