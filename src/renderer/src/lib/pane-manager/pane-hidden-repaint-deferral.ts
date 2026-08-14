/**
 * Carries a repaint request across a pane manager's hidden window.
 *
 * Why: a repaint that arrives while a terminal tab is hidden is simply lost —
 * `safeFit` refuses a display:none pane (no measurable box) and `refresh` has no
 * presented frame to update. The tab's reveal is the next moment those panes can
 * be repaired, so park the request on the manager and let the reveal replay it
 * instead of leaving the panes unpainted until the user resizes something.
 */
const managersAwaitingRevealRepaint = new WeakSet<object>()

export function deferPaneManagerRepaintUntilReveal(manager: object): void {
  managersAwaitingRevealRepaint.add(manager)
}

/** Returns true once per parked repaint; the reveal owns the repair from here. */
export function consumeDeferredPaneManagerRepaint(manager: object): boolean {
  return managersAwaitingRevealRepaint.delete(manager)
}
