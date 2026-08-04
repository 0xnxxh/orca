import { useEffect, useRef, useState } from 'react'
import type { AskPrompt } from './mobile-native-chat-ask'

/** Track the answered-ask key so the lingering live status doesn't re-show the
 *  same card. The agent emits a post-tool event with the same prompt right after
 *  an answer, so the card is hidden until a genuinely different question arrives.
 *
 *  Owned by the controller, not the chat subtree: the overlay unmounts on a
 *  chat↔terminal view toggle, and a dismissal must survive that round-trip. */
export function useMobileNativeChatAskDismiss(args: {
  ask?: AskPrompt | null
  /** Ungated prompt payload. A working/done status hides the card but does not
   *  prove the sticky prompt itself cleared. */
  detectedAsk?: AskPrompt | null
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
  const { ask, detectedAsk = ask, scopeKey, observing } = args
  const askKey = ask ? JSON.stringify(ask.questions) : null
  const detectedAskKey = detectedAsk ? JSON.stringify(detectedAsk.questions) : null
  const detectedAskKeysRef = useRef(new Map<string | null, string | null>())
  if (observing) {
    detectedAskKeysRef.current.set(scopeKey, detectedAskKey)
  }
  const [dismissedByScope, setDismissedByScope] = useState<Map<string | null, string>>(
    () => new Map()
  )
  // A cleared or genuinely different detected prompt retires the old dismissal.
  useEffect(() => {
    if (observing) {
      setDismissedByScope((previous) => {
        const dismissedKey = previous.get(scopeKey)
        if (dismissedKey === undefined || dismissedKey === detectedAskKey) {
          return previous
        }
        const next = new Map(previous)
        next.delete(scopeKey)
        return next
      })
    }
  }, [observing, detectedAskKey, scopeKey])
  const showAsk = askKey !== null && dismissedByScope.get(scopeKey) !== askKey
  const dismissAsk = (): void => {
    // An answer may settle after the prompt cleared or was replaced. Only the
    // still-current prompt may install a lasting dismissal.
    if (askKey !== null && detectedAskKeysRef.current.get(scopeKey) === askKey) {
      setDismissedByScope((previous) => new Map(previous).set(scopeKey, askKey))
    }
  }

  return { askKey, showAsk, dismissAsk }
}
