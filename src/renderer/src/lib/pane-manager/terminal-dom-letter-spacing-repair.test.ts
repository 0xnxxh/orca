// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPane } from './pane-manager-types'
import { setTerminalWebglDiagnosticRecorder } from '../../../../shared/terminal-webgl-diagnostics'
import { repairPaneDomLetterSpacingMismatch } from './terminal-dom-letter-spacing-repair'
// Import for its side effect: registers the fit-success hook under test below.
import './pane-webgl-renderer'
import { notifyPaneFitSucceeded } from './pane-fit-webgl-attach-signal'

type RepairPaneOptions = {
  letterSpacing?: string
  withRows?: boolean
  measure?: () => void
}

function createDomPane({
  letterSpacing = '8.43px',
  withRows = true,
  measure
}: RepairPaneOptions = {}): {
  pane: ManagedPane
  spies: { measure: ReturnType<typeof vi.fn>; dprChange: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn> }
} {
  const container = document.createElement('div')
  if (withRows) {
    const rows = document.createElement('div')
    rows.className = 'xterm-rows'
    rows.style.letterSpacing = letterSpacing
    container.appendChild(rows)
  }
  const charSizeService = { width: 16.857, height: 32, measure: vi.fn(measure) }
  const dprChange = vi.fn()
  const refresh = vi.fn()
  const pane = {
    id: 7,
    container,
    // Keep the shared fit hook's other consumers inert: no addon wanted.
    webglAddon: null,
    gpuRenderingEnabled: false,
    webglAttachmentDeferred: false,
    webglDisabledAfterContextLoss: false,
    webglAttachFailedSinceRecovery: false,
    terminal: {
      rows: 10,
      cols: 80,
      options: { fontSize: 14 },
      refresh,
      _core: {
        _charSizeService: charSizeService,
        _renderService: {
          _renderer: { value: { handleDevicePixelRatioChange: dprChange } },
          dimensions: { css: { cell: { width: 16.859 } } }
        }
      }
    }
  } as unknown as ManagedPane
  return { pane, spies: { measure: charSizeService.measure, dprChange, refresh } }
}

afterEach(() => {
  setTerminalWebglDiagnosticRecorder(null)
})

describe('repairPaneDomLetterSpacingMismatch', () => {
  it('re-measures and rebuilds dimensions when default spacing is far from zero', () => {
    const { pane, spies } = createDomPane({ letterSpacing: '8.43055px' })
    expect(repairPaneDomLetterSpacingMismatch(pane)).toBe(true)
    expect(spies.measure).toHaveBeenCalledOnce()
    expect(spies.dprChange).toHaveBeenCalledOnce()
    expect(spies.refresh).toHaveBeenCalledWith(0, 9)
  })

  it('repairs a large negative (squished) spacing too', () => {
    const { pane, spies } = createDomPane({ letterSpacing: '-6.2px' })
    expect(repairPaneDomLetterSpacingMismatch(pane)).toBe(true)
    expect(spies.measure).toHaveBeenCalledOnce()
  })

  it('leaves healthy sub-pixel spacing alone', () => {
    const { pane, spies } = createDomPane({ letterSpacing: '0.000918692px' })
    expect(repairPaneDomLetterSpacingMismatch(pane)).toBe(false)
    expect(spies.measure).not.toHaveBeenCalled()
    expect(spies.refresh).not.toHaveBeenCalled()
  })

  it('ignores WebGL panes (no rows container)', () => {
    const { pane, spies } = createDomPane({ withRows: false })
    expect(repairPaneDomLetterSpacingMismatch(pane)).toBe(false)
    expect(spies.measure).not.toHaveBeenCalled()
  })

  it('records the mismatch as a diagnostic with before/after values', () => {
    const recorded: { kind: string; detail?: Record<string, unknown> }[] = []
    setTerminalWebglDiagnosticRecorder((kind, detail) => recorded.push({ kind, detail }))
    const { pane } = createDomPane({
      letterSpacing: '8.43px',
      measure: function (this: void) {
        // Re-measure heals the poisoned width.
      }
    })
    const core = (pane.terminal as unknown as { _core: { _charSizeService: { width: number; measure: () => void } } })
      ._core
    core._charSizeService.measure = vi.fn(() => {
      core._charSizeService.width = 8.4287
    })
    expect(repairPaneDomLetterSpacingMismatch(pane)).toBe(true)
    expect(recorded).toHaveLength(1)
    expect(recorded[0].kind).toBe('dom-letter-spacing-repair')
    expect(recorded[0].detail).toMatchObject({
      paneId: 7,
      defaultSpacingPx: 8.43,
      beforeCharWidth: 16.857,
      afterCharWidth: 8.4287,
      fontSize: 14
    })
  })

  it('runs from the fit-success hook (import-time registration)', () => {
    const { pane, spies } = createDomPane({ letterSpacing: '8.43px' })
    notifyPaneFitSucceeded(pane)
    expect(spies.measure).toHaveBeenCalledOnce()
    expect(spies.dprChange).toHaveBeenCalledOnce()
  })
})
