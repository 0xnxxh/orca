// Why: worktree-level terminal/browser/emulator overlays pin to each group's
// body via CSS anchor positioning. After a pane-column snap Chromium can leave
// the painted box and hit-test box disagreeing (or leave the overlay covering
// chrome that should stay clickable). Measuring the body and correcting the
// overlay is the portable recovery path for Electron, web, and remote hosts.

export type OverlaySlotRect = {
  top: number
  left: number
  width: number
  height: number
}

export const OVERLAY_SLOT_GEOMETRY_MISMATCH_PX = 2

export function findTabGroupBodyElement(groupId: string): HTMLElement | null {
  for (const candidate of document.querySelectorAll<HTMLElement>('[data-tab-group-body-id]')) {
    if (candidate.dataset.tabGroupBodyId === groupId) {
      return candidate
    }
  }
  return null
}

export function measureOverlaySlotRect(
  parent: HTMLElement,
  body: HTMLElement
): OverlaySlotRect {
  const parentRect = parent.getBoundingClientRect()
  const bodyRect = body.getBoundingClientRect()
  return {
    top: bodyRect.top - parentRect.top,
    left: bodyRect.left - parentRect.left,
    width: bodyRect.width,
    height: bodyRect.height
  }
}

export function isOverlaySlotGeometryMismatched(
  overlayRect: Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>,
  bodyRect: Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>,
  tolerancePx = OVERLAY_SLOT_GEOMETRY_MISMATCH_PX
): boolean {
  return (
    Math.abs(overlayRect.top - bodyRect.top) > tolerancePx ||
    Math.abs(overlayRect.left - bodyRect.left) > tolerancePx ||
    Math.abs(overlayRect.width - bodyRect.width) > tolerancePx ||
    Math.abs(overlayRect.height - bodyRect.height) > tolerancePx
  )
}

export function shouldPreferMeasuredOverlayGeometry(args: {
  overlay: HTMLElement | null
  groupId: string | undefined
  /** When true, stay on the measured path until the caller resets (e.g. new group). */
  forceMeasured: boolean
}): { preferMeasured: boolean; measured: OverlaySlotRect | null } {
  if (!args.groupId || !args.overlay) {
    return { preferMeasured: args.forceMeasured, measured: null }
  }
  const parent = args.overlay.parentElement
  const body = findTabGroupBodyElement(args.groupId)
  if (!parent || !body) {
    return { preferMeasured: true, measured: null }
  }
  const measured = measureOverlaySlotRect(parent, body)
  if (args.forceMeasured) {
    return { preferMeasured: true, measured }
  }
  const bodyRect = body.getBoundingClientRect()
  const overlayRect = args.overlay.getBoundingClientRect()
  if (isOverlaySlotGeometryMismatched(overlayRect, bodyRect)) {
    return { preferMeasured: true, measured }
  }
  return { preferMeasured: false, measured }
}
