import { useEffect, useState } from 'react'
import type { AskPrompt } from './mobile-native-chat-ask'

/** Track the answered-ask key so the lingering live status doesn't re-show the
 *  same card. The agent emits a post-tool event with the same prompt right after
 *  an answer, so the card is hidden until a genuinely different question arrives.
 *
 *  Owned by the controller, not the chat subtree: the overlay unmounts on a
 *  chat↔terminal view toggle, and a dismissal must survive that round-trip. */
export function useMobileNativeChatAskDismiss(args: {
  ask?: AskPrompt | null
  /** Dismissals are scoped to the tab that showed the card, so one tab's
   *  dismissal can't hide an identical question on another tab. */
  scopeKey: string | null
  /** True while the chat surface can actually observe the prompt. A null ask
   *  while hidden proves nothing (prompts aren't derived off-chat) and must not
   *  reset the dismissal — that reset is what resurfaced dismissed cards. */
  observing: boolean
}): {
  askKey: string | null
  showAsk: boolean
  dismissAsk: () => void
} {
  const { ask, scopeKey, observing } = args
  const askKey = ask ? JSON.stringify(ask.questions) : null
  const [dismissed, setDismissed] = useState<{ scope: string | null; key: string } | null>(null)
  // Once the prompt clears while observable (agent moved on), forget the
  // dismissal so a later question — even an identical one — shows again.
  const askPresent = ask != null
  useEffect(() => {
    if (observing && !askPresent) {
      setDismissed((prev) => (prev !== null && prev.scope === scopeKey ? null : prev))
    }
  }, [observing, askPresent, scopeKey])
  const showAsk =
    askPresent && !(dismissed !== null && dismissed.scope === scopeKey && dismissed.key === askKey)
  const dismissAsk = (): void => {
    if (askKey !== null) {
      setDismissed({ scope: scopeKey, key: askKey })
    }
  }

  return { askKey, showAsk, dismissAsk }
}
