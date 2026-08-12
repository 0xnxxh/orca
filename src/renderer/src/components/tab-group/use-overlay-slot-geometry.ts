import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import {
  findTabGroupBodyElement,
  measureOverlaySlotRect,
  shouldPreferMeasuredOverlayGeometry,
  type OverlaySlotRect
} from './overlay-slot-geometry'

const FALLBACK_RECT_MIN_CHANGE_PX = 1

function stabilizeMeasuredRect(
  prev: OverlaySlotRect | null,
  next: OverlaySlotRect
): OverlaySlotRect {
  if (
    prev &&
    Math.abs(prev.top - next.top) < FALLBACK_RECT_MIN_CHANGE_PX &&
    Math.abs(prev.left - next.left) < FALLBACK_RECT_MIN_CHANGE_PX &&
    Math.abs(prev.width - next.width) < FALLBACK_RECT_MIN_CHANGE_PX &&
    Math.abs(prev.height - next.height) < FALLBACK_RECT_MIN_CHANGE_PX
  ) {
    return prev
  }
  return next
}

/**
 * Tracks tab-group body geometry for a worktree-level overlay slot.
 * When CSS anchors desync after a column snap, forceMeasured becomes true and
 * the caller should pin the overlay with measured top/left/width/height.
 *
 * Why: render stays pure (no ref writes during render). isVisible only gates
 * new latches — a proven forceMeasured survives hide/reveal. Observers always
 * tear down via the effect cleanup return (React Doctor effect-needs-cleanup).
 */
export function useOverlaySlotGeometry(args: {
  overlayRef: RefObject<HTMLElement | null>
  groupId: string | undefined
  worktreeId?: string
  /** When false (e.g. web client), always use measured geometry. */
  cssAnchorsSupported: boolean
  isVisible: boolean
}): {
  measuredRect: OverlaySlotRect | null
  forceMeasured: boolean
  useCssAnchors: boolean
} {
  const [measuredRect, setMeasuredRect] = useState<OverlaySlotRect | null>(null)
  const [forceMeasured, setForceMeasured] = useState(false)
  // Why: read in observer callbacks without putting isVisible in the effect deps
  // (deps would re-run the effect and clear forceMeasured on every hide/reveal).
  const isVisibleRef = useRef(args.isVisible)
  isVisibleRef.current = args.isVisible

  useLayoutEffect(() => {
    // Why: only group/worktree/css support changes re-arm CSS anchors — not visibility.
    setForceMeasured(false)

    if (!args.groupId) {
      // Why: always return a cleanup so effect-needs-cleanup stays satisfied on this path.
      return () => {}
    }

    let latchedMeasured = false
    let observedBody: Element | null = null
    let observedParent: Element | null = null
    let rafId = 0

    const resizeObserver = new ResizeObserver(() => {
      update()
    })

    const syncObservation = (body: Element | null, parent: Element | null): void => {
      if (body !== observedBody) {
        if (observedBody) {
          resizeObserver.unobserve(observedBody)
        }
        if (body) {
          resizeObserver.observe(body)
        }
        observedBody = body
      }
      if (parent !== observedParent) {
        if (observedParent) {
          resizeObserver.unobserve(observedParent)
        }
        if (parent) {
          resizeObserver.observe(parent)
        }
        observedParent = parent
      }
    }

    const update = (): void => {
      const overlay = args.overlayRef.current
      const parent = overlay?.parentElement ?? null
      const body = findTabGroupBodyElement(args.groupId!, args.worktreeId)
      // Why: body may mount after the effect (split leaf paint). Re-attach RO when
      // the worktree-scoped query starts resolving without polling.
      syncObservation(body, parent)
      if (!parent || !body) {
        // Why: mid-reparent body absence is transient; keep last good measured
        // box so we do not expand to width 100% over tab chrome.
        return
      }
      const next = measureOverlaySlotRect(parent, body)
      setMeasuredRect((prev) => stabilizeMeasuredRect(prev, next))

      if (!args.cssAnchorsSupported) {
        return
      }
      const decision = shouldPreferMeasuredOverlayGeometry({
        overlay: overlay ?? null,
        groupId: args.groupId,
        worktreeId: args.worktreeId,
        forceMeasured: latchedMeasured,
        mayLatchDesync: isVisibleRef.current
      })
      if (decision.preferMeasured && !latchedMeasured) {
        latchedMeasured = true
        setForceMeasured(true)
      }
      if (decision.measured) {
        setMeasuredRect((prev) => stabilizeMeasuredRect(prev, decision.measured!))
      }
    }

    update()
    // Why: rAF catches the frame after a pane-column snap reflow when RO may
    // not fire (body size unchanged but anchor resolution changed).
    rafId = requestAnimationFrame(update)

    // Why: tab-group bodies are siblings outside the overlay tree and often
    // mount/replace after this effect; subtree mutations re-run attach for the
    // scoped body only (findTabGroupBodyElement is worktree-scoped).
    const mutationObserver = new MutationObserver(() => {
      update()
    })
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    })
    window.addEventListener('resize', update)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', update)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      observedBody = null
      observedParent = null
    }
  }, [args.cssAnchorsSupported, args.groupId, args.overlayRef, args.worktreeId])

  return {
    measuredRect,
    forceMeasured,
    useCssAnchors: args.cssAnchorsSupported && !forceMeasured
  }
}
