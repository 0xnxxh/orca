import type { ManagedPane } from './pane-manager-types'
import { recordTerminalWebglDiagnostic } from '../../../../shared/terminal-webgl-diagnostics'

/** The xterm options whose writes trigger a cell-size re-measure. */
export type PaneMetricOptions = {
  fontSize?: number
  fontFamily?: string
  fontWeight?: string | number
  fontWeightBold?: string | number
  lineHeight?: number
}

const deferredMetricOptions = new WeakMap<ManagedPane, PaneMetricOptions>()

/**
 * Why: writing fontSize/fontFamily/lineHeight makes xterm re-measure cell size
 * against the pane's current box. A hidden or mid-layout pane can measure a
 * wrong-but-nonzero size, which latches (hasValidSize) and mis-keys the shared
 * WebGL glyph atlas until a manual resize. Metric writes therefore only land on
 * measurable panes; the rest park here until a fit or reveal flushes them.
 * xterm's option setters no-op on unchanged values, so applying is cheap.
 */
export function applyOrDeferPaneMetricOptions(
  pane: ManagedPane,
  options: PaneMetricOptions,
  measurable: boolean
): 'applied' | 'deferred' {
  if (!measurable) {
    // Latest wins: a newer settings change while hidden supersedes the pending one.
    deferredMetricOptions.set(pane, options)
    return 'deferred'
  }
  deferredMetricOptions.delete(pane)
  writePaneMetricOptions(pane, options)
  return 'applied'
}

/** Applies a pending deferral. Callers must ensure the pane is measurable. */
export function flushDeferredPaneMetricOptions(pane: ManagedPane): boolean {
  const pending = deferredMetricOptions.get(pane)
  if (!pending) {
    return false
  }
  deferredMetricOptions.delete(pane)
  writePaneMetricOptions(pane, pending)
  recordTerminalWebglDiagnostic('metric-options-deferred-flush', { paneId: pane.id })
  return true
}

export function hasDeferredPaneMetricOptions(pane: ManagedPane): boolean {
  return deferredMetricOptions.has(pane)
}

function writePaneMetricOptions(pane: ManagedPane, options: PaneMetricOptions): void {
  const target = pane.terminal.options
  if (options.fontSize !== undefined) {
    target.fontSize = options.fontSize
  }
  if (options.fontFamily !== undefined) {
    target.fontFamily = options.fontFamily
  }
  if (options.fontWeight !== undefined) {
    target.fontWeight = options.fontWeight as typeof target.fontWeight
  }
  if (options.fontWeightBold !== undefined) {
    target.fontWeightBold = options.fontWeightBold as typeof target.fontWeightBold
  }
  if (options.lineHeight !== undefined) {
    target.lineHeight = options.lineHeight
  }
}
