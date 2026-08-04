import { useCallback, useEffect, useRef } from 'react'

/** Never let the hold outlive a paging cycle: a page that prepends nothing
 *  (failed, empty, or resolved onto a swapped session) produces no layout pass
 *  to consume it, and a stuck `loadingEarlier` would otherwise disable
 *  tail-follow for good. Re-armed on each transition, so a slow round trip just
 *  re-holds when the page lands. */
const HISTORY_HOLD_MAX_MS = 500

export type MobileNativeChatHistoryHold = {
  /** True while a paging cycle's layout passes are still expected. */
  isHeld: () => boolean
  /** Consume the hold — call from the layout pass that the prepend produced. */
  release: () => void
}

/**
 * Suppress tail-follow across a `loadEarlier` cycle.
 *
 * The hold is a latch, not a per-render snapshot of `loadingEarlier`: a
 * streaming tick or keystroke rendering between the prepend commit and the
 * native content-size event would drop a snapshot, and the tail-follow would
 * then scroll away the history that just paged in.
 *
 * It covers the whole cycle, not just delivery — swapping the spinner into the
 * header resizes it, and that layout pass would otherwise scroll the reader to
 * the bottom the moment they tap "Load earlier".
 */
export function useMobileNativeChatHistoryHold(
  loadingEarlier: boolean | undefined
): MobileNativeChatHistoryHold {
  const heldRef = useRef(false)
  const inFlightRef = useRef(false)
  const expiryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearExpiry = useCallback(() => {
    if (expiryRef.current) {
      clearTimeout(expiryRef.current)
      expiryRef.current = null
    }
  }, [])

  const hold = useCallback(() => {
    heldRef.current = true
    clearExpiry()
    expiryRef.current = setTimeout(() => {
      heldRef.current = false
      expiryRef.current = null
    }, HISTORY_HOLD_MAX_MS)
  }, [clearExpiry])

  const isHeld = useCallback(() => heldRef.current, [])
  // Each layout pass consumes one hold; the spinner's pass is re-held when the
  // page is delivered, so it costs nothing to let it consume this one.
  const release = useCallback(() => {
    heldRef.current = false
    clearExpiry()
  }, [clearExpiry])

  useEffect(() => {
    if (loadingEarlier) {
      inFlightRef.current = true
      hold()
      return
    }
    if (!inFlightRef.current) {
      return
    }
    inFlightRef.current = false
    hold()
  }, [loadingEarlier, hold])

  useEffect(() => () => clearExpiry(), [clearExpiry])

  // Both callbacks are stable, so a consumer can depend on them individually
  // without this object's identity mattering.
  return { isHeld, release }
}
