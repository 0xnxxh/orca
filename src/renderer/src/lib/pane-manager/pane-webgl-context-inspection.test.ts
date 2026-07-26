import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPaneInternal } from './pane-manager-types'

describe('terminal WebGL context inspection', () => {
  afterEach(async () => {
    const { setTerminalWebglDiagnosticRecorder } =
      await import('../../../../shared/terminal-webgl-diagnostics')
    setTerminalWebglDiagnosticRecorder(null)
    vi.resetModules()
  })

  it('records missing xterm internals once without treating the context as lost', async () => {
    vi.resetModules()
    const diagnostics = vi.fn()
    const { setTerminalWebglDiagnosticRecorder } =
      await import('../../../../shared/terminal-webgl-diagnostics')
    setTerminalWebglDiagnosticRecorder(diagnostics)
    const { isPaneWebglContextLost } = await import('./pane-webgl-renderer')
    const pane = { id: 7, webglAddon: {} } as ManagedPaneInternal

    expect(isPaneWebglContextLost(pane)).toBe(false)
    expect(isPaneWebglContextLost(pane)).toBe(false)
    expect(diagnostics).toHaveBeenCalledTimes(1)
    expect(diagnostics).toHaveBeenCalledWith('webgl-context-inspection-unavailable', { paneId: 7 })
  })
})
