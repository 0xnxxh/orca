import { describe, expect, it } from 'vitest'
import type { ManagedPane } from './pane-manager-types'
import {
  applyOrDeferPaneMetricOptions,
  flushDeferredPaneMetricOptions,
  hasDeferredPaneMetricOptions
} from './pane-metric-options-deferral'

function makePane(): ManagedPane {
  return { id: 1, terminal: { options: {} } } as unknown as ManagedPane
}

describe('pane-metric-options-deferral', () => {
  it('writes metric options directly when the pane is measurable', () => {
    const pane = makePane()

    const result = applyOrDeferPaneMetricOptions(pane, { fontSize: 16, fontFamily: 'X' }, true)

    expect(result).toBe('applied')
    expect(pane.terminal.options.fontSize).toBe(16)
    expect(pane.terminal.options.fontFamily).toBe('X')
    expect(hasDeferredPaneMetricOptions(pane)).toBe(false)
  })

  it('defers writes on an unmeasurable pane until flushed', () => {
    const pane = makePane()

    const result = applyOrDeferPaneMetricOptions(pane, { fontSize: 16 }, false)

    expect(result).toBe('deferred')
    expect(pane.terminal.options.fontSize).toBeUndefined()
    expect(hasDeferredPaneMetricOptions(pane)).toBe(true)

    expect(flushDeferredPaneMetricOptions(pane)).toBe(true)
    expect(pane.terminal.options.fontSize).toBe(16)
    expect(hasDeferredPaneMetricOptions(pane)).toBe(false)
  })

  it('keeps only the latest deferral and clears it when a measurable apply lands', () => {
    const pane = makePane()

    applyOrDeferPaneMetricOptions(pane, { fontSize: 15 }, false)
    applyOrDeferPaneMetricOptions(pane, { fontSize: 21 }, false)
    // A later measurable apply supersedes the pending deferral entirely: flushing
    // afterwards must not resurrect the hidden-era value.
    applyOrDeferPaneMetricOptions(pane, { fontSize: 18 }, true)

    expect(pane.terminal.options.fontSize).toBe(18)
    expect(flushDeferredPaneMetricOptions(pane)).toBe(false)
    expect(pane.terminal.options.fontSize).toBe(18)
  })

  it('writes only the provided keys', () => {
    const pane = makePane()
    pane.terminal.options.lineHeight = 1.4

    applyOrDeferPaneMetricOptions(pane, { fontSize: 12 }, true)

    expect(pane.terminal.options.lineHeight).toBe(1.4)
    expect(pane.terminal.options.fontWeight).toBeUndefined()
  })

  it('flush is a no-op without a pending deferral', () => {
    const pane = makePane()
    expect(flushDeferredPaneMetricOptions(pane)).toBe(false)
  })
})
