import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreloadApi } from './api-types'

const { exposeInMainWorld, invoke } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: {
    invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
    sendSync: vi.fn()
  },
  webFrame: {
    getZoomFactor: vi.fn(() => 1),
    setZoomFactor: vi.fn(),
    setVisualZoomLevelLimits: vi.fn()
  },
  webUtils: { getPathForFile: vi.fn(() => '') }
}))

vi.mock('@electron-toolkit/preload', () => ({ electronAPI: {} }))

describe('preload startup diagnostics contract', () => {
  const originalContextIsolated = Object.getOwnPropertyDescriptor(process, 'contextIsolated')
  const originalDiagnostics = process.env.ORCA_STARTUP_DIAGNOSTICS

  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockReset()
    invoke.mockReset()
    Object.defineProperty(process, 'contextIsolated', { configurable: true, value: true })
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      removeEventListener: vi.fn()
    })
    vi.stubGlobal('document', { addEventListener: vi.fn() })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalDiagnostics === undefined) {
      delete process.env.ORCA_STARTUP_DIAGNOSTICS
    } else {
      process.env.ORCA_STARTUP_DIAGNOSTICS = originalDiagnostics
    }
    if (originalContextIsolated) {
      Object.defineProperty(process, 'contextIsolated', originalContextIsolated)
    } else {
      Reflect.deleteProperty(process, 'contextIsolated')
    }
  })

  async function loadApi(enabled: boolean): Promise<PreloadApi> {
    if (enabled) {
      process.env.ORCA_STARTUP_DIAGNOSTICS = '1'
    } else {
      delete process.env.ORCA_STARTUP_DIAGNOSTICS
    }
    await import('./index')
    return exposeInMainWorld.mock.calls.find(([name]) => name === 'api')?.[1] as PreloadApi
  }

  it('exposes the enabled state and forwards renderer milestones when enabled', async () => {
    const api = await loadApi(true)

    expect(api.app.startupDiagnosticsEnabled).toBe(true)
    await api.app.startupDiagnostic('renderer-first-react-commit', { rendererT: 12 })
    expect(invoke).toHaveBeenCalledWith('app:startupDiagnostic', 'renderer-first-react-commit', {
      rendererT: 12
    })
  })

  it('keeps disabled milestones off IPC', async () => {
    const api = await loadApi(false)

    expect(api.app.startupDiagnosticsEnabled).toBe(false)
    await api.app.startupDiagnostic('renderer-first-react-commit')
    expect(invoke).not.toHaveBeenCalledWith(
      'app:startupDiagnostic',
      'renderer-first-react-commit',
      undefined
    )
  })
})
