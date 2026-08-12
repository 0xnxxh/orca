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
  const forceMeasuredRef = useRef(false)
  forceMeasuredRef.current = forceMeasured

  // Why: single layout effect owns group transitions + RO so forceMeasured
  // reset and re-observe cannot race across two effects in the same commit.
  useLayoutEffect(() => {
    if (!args.groupId) {
      return
    }

    forceMeasuredRef.current = false
    setForceMeasured(false)

    const update = (): void => {
      const overlay = args.overlayRef.current
      const parent = overlay?.parentElement
      const body = findTabGroupBodyElement(args.groupId!, args.worktreeId)
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
        forceMeasured: forceMeasuredRef.current,
        mayLatchDesync: args.isVisible
      })
      if (decision.preferMeasured && !forceMeasuredRef.current) {
        forceMeasuredRef.current = true
        setForceMeasured(true)
      }
      if (decision.measured) {
        setMeasuredRect((prev) => stabilizeMeasuredRect(prev, decision.measured!))
      }
    }

    update()
    // Why: rAF catches the frame after a pane-column snap reflow when RO may
    // not fire (body size unchanged but anchor resolution changed).
    const rafId = requestAnimationFrame(update)
    const body = findTabGroupBodyElement(args.groupId, args.worktreeId)
    const parent = args.overlayRef.current?.parentElement
    const resizeObserver = new ResizeObserver(update)
    if (body) {
      resizeObserver.observe(body)
    }
    if (parent) {
      resizeObserver.observe(parent)
    }
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [
    args.cssAnchorsSupported,
    args.groupId,
    args.isVisible,
    args.overlayRef,
    args.worktreeId
  ])

  return {
    measuredRect,
    forceMeasured,
    useCssAnchors: args.cssAnchorsSupported && !forceMeasured
  }
}
