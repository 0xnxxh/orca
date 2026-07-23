import type { ManagedPane, ManagedPaneInternal } from './pane-manager-types'
import {
  canMeasurePaneForFit,
  flushPendingSafeFitContinuations,
  readFitClientSize,
  safeFit
} from './pane-fit'
import { requestStablePaneFit } from './pane-fit-resize-observer'
import { clearPaneFitContinuationRetry } from './pane-fit-continuation-retry'
import { resumePendingFitScrollRestoreAfterFit } from './pane-scroll'

// Why: reveal uses this to tell a real hidden-time geometry change (fit) from an
// unchanged element whose proposed grid could only move under the DOM<->WebGL
// cell-metric swap (skip). No baseline / unmeasurable counts as changed.
export function paneFitClientSizeChanged(pane: ManagedPane): boolean {
  const last = (pane as ManagedPaneInternal).lastFitClientSize
  if (!last) {
    return true
  }
  const current = readFitClientSize(pane)
  if (!current || current.width <= 0 || current.height <= 0) {
    return true
  }
  return current.width !== last.width || current.height !== last.height
}

function releaseMeasurableFitContinuations(pane: ManagedPane): void {
  // Why: the grid is already correct so no reflow is needed, but a pane that
  // mounted hidden can have replay/reattach continuations parked on a measurable
  // fit — release them now it is visible, without resizing.
  if (!canMeasurePaneForFit(pane)) {
    return
  }
  // Why: parity with safeFit's equal-dims path — resume a scroll restore parked
  // "for the next fit" so a matching-grid reveal does not strand it.
  resumePendingFitScrollRestoreAfterFit(pane.terminal)
  flushPendingSafeFitContinuations(pane)
  clearPaneFitContinuationRetry(pane)
}

// Why: does the fit element propose the grid xterm already holds? Missing/failed
// measurement counts as "matches" — releaseMeasurableFitContinuations re-guards
// measurability and safeFit would no-op anyway, so it must not force a reflow.
function proposedGridMatchesTerminal(pane: ManagedPane): boolean {
  try {
    const proposed = pane.fitAddon.proposeDimensions()
    if (!proposed) {
      return true
    }
    return proposed.cols === pane.terminal.cols && proposed.rows === pane.terminal.rows
  } catch {
    return true
  }
}

// Reveal fit (minimize→restore, worktree foreground, window wake). Fit
// synchronously when the fit element's pixels changed while hidden — a real
// resize (which also keeps xterm ahead of the async {fit:false} PTY size reassert
// so it can't forward a stale grid). If the pixels are unchanged but the grid
// diverged while hidden (a direct terminal.resize from snapshot / SSH-reattach,
// or an appearance/DPI change), repair it on a steady grid — a sustained mismatch
// refits, a transient DOM<->WebGL cell-metric wobble does not reflow (which is
// what garbles diff-painting inline TUIs like grok/Codex on reveal). An unchanged
// grid is left alone.
export function fitRevealedPane(pane: ManagedPane): void {
  if (paneFitClientSizeChanged(pane)) {
    safeFit(pane)
    return
  }
  if (proposedGridMatchesTerminal(pane)) {
    releaseMeasurableFitContinuations(pane)
  } else {
    requestStablePaneFit(pane)
  }
}
