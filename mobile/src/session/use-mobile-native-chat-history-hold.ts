import { useCallback, useEffect, useRef } from 'react'

/** How long the viewport stays pinned after a paging cycle moves.
 *
 *  Deliberately a window rather than a count of layout passes: a prepended page
 *  settles over SEVERAL content-size events as its cells measure and
 *  VirtualizedList revises its spacer estimates, so retiring the hold on the
 *  first pass would let a later one scroll to the bottom anyway. A window also
 *  lapses on its own when a page prepends nothing (failed, empty, or resolved
 *  onto a swapped session), which no pass-counting scheme can do. */
const HISTORY_HOLD_MS = 500

export type MobileNativeChatHistoryHold = {
  /** True while a paging cycle's layout passes are still expected. */
  isHeld: () => boolean
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
    }, HISTORY_HOLD_MS)
  }, [clearExpiry])

  const isHeld = useCallback(() => heldRef.current, [])

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

  // `isHeld` is stable, so a consumer can depend on it directly without this
  // object's identity mattering.
  return { isHeld }
}
