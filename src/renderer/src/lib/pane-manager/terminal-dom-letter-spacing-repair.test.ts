// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPane } from './pane-manager-types'
import { setTerminalWebglDiagnosticRecorder } from '../../../../shared/terminal-webgl-diagnostics'
import { repairPaneDomLetterSpacingMismatch } from './terminal-dom-letter-spacing-repair'

type RepairPaneOptions = {
  letterSpacing?: string
  afterLetterSpacing?: string
  configuredLetterSpacing?: number
  measurable?: boolean
  withRows?: boolean
  measure?: () => void
}

function createDomPane({
  letterSpacing = '8.43px',
  afterLetterSpacing = '0.001px',
  configuredLetterSpacing = 0,
  measurable = true,
  withRows = true,
  measure
}: RepairPaneOptions = {}): {
  pane: ManagedPane
  spies: {
    boxMeasure: ReturnType<typeof vi.fn>
    measure: ReturnType<typeof vi.fn>
    dprChange: ReturnType<typeof vi.fn>
    refresh: ReturnType<typeof vi.fn>
  }
} {
  const container = document.createElement('div')
  const boxMeasure = vi.fn(
    () => ({ width: measurable ? 800 : 0, height: measurable ? 600 : 0 }) as DOMRect
  )
  container.getBoundingClientRect = boxMeasure
  let rows: HTMLElement | null = null
  if (withRows) {
    rows = document.createElement('div')
    rows.className = 'xterm-rows'
    rows.style.letterSpacing = letterSpacing
    container.appendChild(rows)
  }
  const charSizeService = { width: 16.857, height: 32, measure: vi.fn(measure) }
  const dprChange = vi.fn(() => {
    if (rows) {
      rows.style.letterSpacing = afterLetterSpacing
    }
  })
  const refresh = vi.fn()
  const pane = {
    id: 7,
    container,
    fitAddon: {
      proposeDimensions: vi.fn(() => (measurable ? { cols: 80, rows: 10 } : undefined))
    },
    terminal: {
      rows: 10,
      cols: 80,
      options: { fontSize: 14, letterSpacing: configuredLetterSpacing },
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
  return { pane, spies: { boxMeasure, measure: charSizeService.measure, dprChange, refresh } }
}

afterEach(() => {
  setTerminalWebglDiagnosticRecorder(null)
})

describe('repairPaneDomLetterSpacingMismatch', () => {
  it('re-measures and rebuilds dimensions when default spacing is far from zero', () => {
    const { pane, spies } = createDomPane({ letterSpacing: '8.43055px' })
    expect(repairPaneDomLetterSpacingMismatch(pane)).toBe(true)
    expect(spies.measure).toHaveBeenCalledOnce()
    expect(spies.boxMeasure).toHaveBeenCalledOnce()
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
    expect(spies.boxMeasure).not.toHaveBeenCalled()
  })

  it('preserves intentional xterm letter spacing', () => {
    const { pane, spies } = createDomPane({
      letterSpacing: '2.0009px',
      configuredLetterSpacing: 2
    })
    expect(repairPaneDomLetterSpacingMismatch(pane)).toBe(false)
    expect(spies.measure).not.toHaveBeenCalled()
    expect(spies.boxMeasure).not.toHaveBeenCalled()
  })

  it('ignores malformed spacing, WebGL panes, zero-size panes, and unknown internals', () => {
    const malformed = createDomPane({ letterSpacing: 'normal' })
    const webgl = createDomPane({ withRows: false })
    const zeroSize = createDomPane({ measurable: false })
    const unknownInternals = createDomPane()
    const unknownTerminal = unknownInternals.pane.terminal as unknown as { _core?: unknown }
    unknownTerminal._core = undefined
    expect(repairPaneDomLetterSpacingMismatch(malformed.pane)).toBe(false)
    expect(repairPaneDomLetterSpacingMismatch(webgl.pane)).toBe(false)
    expect(repairPaneDomLetterSpacingMismatch(zeroSize.pane)).toBe(false)
    expect(repairPaneDomLetterSpacingMismatch(unknownInternals.pane)).toBe(false)
    expect(malformed.spies.measure).not.toHaveBeenCalled()
    expect(webgl.spies.measure).not.toHaveBeenCalled()
    expect(zeroSize.spies.measure).not.toHaveBeenCalled()
    expect(unknownInternals.spies.measure).not.toHaveBeenCalled()
    expect(malformed.spies.boxMeasure).not.toHaveBeenCalled()
    expect(webgl.spies.boxMeasure).not.toHaveBeenCalled()
  })

  it('records truthful before/after repair values', () => {
    const recorded: { kind: string; detail?: Record<string, unknown> }[] = []
    setTerminalWebglDiagnosticRecorder((kind, detail) => recorded.push({ kind, detail }))
    const { pane } = createDomPane()
    const core = (
      pane.terminal as unknown as {
        _core: { _charSizeService: { width: number; measure: () => void } }
      }
    )._core
    core._charSizeService.measure = vi.fn(() => {
      core._charSizeService.width = 8.4287
    })
    expect(repairPaneDomLetterSpacingMismatch(pane)).toBe(true)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      kind: 'dom-letter-spacing-repair',
      detail: {
        paneId: 7,
        defaultSpacingPx: 8.43,
        configuredSpacingPx: 0,
        afterSpacingPx: 0.001,
        beforeCharWidth: 16.857,
        afterCharWidth: 8.4287,
        fontSize: 14,
        repaired: true
      }
    })
  })

  it('bounds an unresolved mismatch to one attempt until metrics recover', () => {
    const { pane, spies } = createDomPane({ afterLetterSpacing: '8.43px' })
    expect(repairPaneDomLetterSpacingMismatch(pane)).toBe(false)
    expect(repairPaneDomLetterSpacingMismatch(pane)).toBe(false)
    expect(spies.measure).toHaveBeenCalledOnce()
    expect(spies.dprChange).toHaveBeenCalledOnce()
  })

  it('contains xterm and diagnostic failures', () => {
    const throwingMeasure = createDomPane({
      measure: () => {
        throw new Error('disposed')
      }
    })
    expect(() => repairPaneDomLetterSpacingMismatch(throwingMeasure.pane)).not.toThrow()
    expect(repairPaneDomLetterSpacingMismatch(throwingMeasure.pane)).toBe(false)

    setTerminalWebglDiagnosticRecorder(() => {
      throw new Error('recorder failed')
    })
    expect(repairPaneDomLetterSpacingMismatch(createDomPane().pane)).toBe(true)
  })
})
