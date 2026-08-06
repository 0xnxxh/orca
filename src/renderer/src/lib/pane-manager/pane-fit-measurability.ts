import type { ManagedPane } from './pane-manager-types'
import { isManagedPaneDisplayNone } from './pane-display-visibility'
import { flushDeferredPaneMetricOptions } from './pane-metric-options-deferral'

const MIN_PANE_FIT_WIDTH_PX = 48
const MIN_PANE_FIT_HEIGHT_PX = 24
const MIN_PANE_FIT_COLS = 8
const MIN_PANE_FIT_ROWS = 4

export function getProposedPaneDimensions(
  pane: ManagedPane
): { cols: number; rows: number } | null {
  try {
    return pane.fitAddon.proposeDimensions() ?? null
  } catch {
    return null
  }
}

export function canMeasurePaneForFit(pane: ManagedPane): boolean {
  const measure = pane.container?.getBoundingClientRect
  if (typeof measure === 'function') {
    const rect = measure.call(pane.container)
    if (rect.width < MIN_PANE_FIT_WIDTH_PX || rect.height < MIN_PANE_FIT_HEIGHT_PX) {
      return false
    }
  }
  const dims = getProposedPaneDimensions(pane)
  if (!dims) {
    return false
  }
  // Why: worktree switches can briefly measure a near-zero overlay before
  // fallback positioning lands. Fitting there pins the PTY at ~2 cols.
  return dims.cols >= MIN_PANE_FIT_COLS && dims.rows >= MIN_PANE_FIT_ROWS
}

export function canApplyPaneMetricOptions(pane: ManagedPane): boolean {
  return !isManagedPaneDisplayNone(pane) && canMeasurePaneForFit(pane)
}

/** Why measurability-gated: flushing metric options into a still-unmeasurable
 *  pane would re-measure against a wrong box — the exact bug deferral prevents. */
export function flushDeferredPaneMetricOptionsIfMeasurable(pane: ManagedPane): boolean {
  if (!canApplyPaneMetricOptions(pane)) {
    return false
  }
  return flushDeferredPaneMetricOptions(pane)
}
