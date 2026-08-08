import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreloadApi } from './api-types'
import {
  TERMINAL_AUTHORITY_APP_PROJECTION_CLEAR_BELL,
  TERMINAL_AUTHORITY_APP_PROJECTION_EVENT,
  TERMINAL_AUTHORITY_APP_PROJECTION_SUBSCRIBE,
  TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
  type TerminalAuthorityAppPaneProjection
} from '../shared/terminal-authority-app-projection'

const { exposeInMainWorld, invoke, on, removeListener, send, sendSync } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
  sendSync: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on, removeListener, send, sendSync },
  webFrame: {
    getZoomFactor: vi.fn(() => 1),
    setZoomFactor: vi.fn(),
    setVisualZoomLevelLimits: vi.fn()
  },
  webUtils: { getPathForFile: vi.fn(() => '') }
}))

vi.mock('@electron-toolkit/preload', () => ({ electronAPI: {} }))

describe('terminal authority projection preload wiring', () => {
  const originalContextIsolated = Object.getOwnPropertyDescriptor(process, 'contextIsolated')

  beforeEach(() => {
    vi.resetModules()
    for (const mock of [exposeInMainWorld, invoke, on, removeListener, send, sendSync]) {
      mock.mockReset()
    }
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
    if (originalContextIsolated) {
      Object.defineProperty(process, 'contextIsolated', originalContextIsolated)
    } else {
      Reflect.deleteProperty(process, 'contextIsolated')
    }
  })

  it('validates projection deltas and snapshots and awaits bell-clear persistence', async () => {
    const row = projectionRow()
    const snapshot = {
      version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
      subscriptionIncarnationId: 'renderer-1',
      rows: [row]
    }
    invoke.mockImplementation((channel: string) => {
      if (channel === TERMINAL_AUTHORITY_APP_PROJECTION_SUBSCRIBE) {
        return Promise.resolve(snapshot)
      }
      if (channel === TERMINAL_AUTHORITY_APP_PROJECTION_CLEAR_BELL) {
        return Promise.resolve(true)
      }
      return Promise.resolve()
    })
    await import('./index')
    const api = exposeInMainWorld.mock.calls.find(([name]) => name === 'api')?.[1] as PreloadApi

    const callback = vi.fn()
    const unsubscribe = api.pty.onAuthorityProjection(callback)
    const listener = on.mock.calls.find(
      ([channel]) => channel === TERMINAL_AUTHORITY_APP_PROJECTION_EVENT
    )?.[1] as (event: unknown, value: unknown) => void
    listener({}, { ...snapshot, rows: [{ ...row, status: { ...row.status, pane: 'closed' } }] })
    listener({}, snapshot)
    expect(callback).toHaveBeenCalledExactlyOnceWith(snapshot)
    unsubscribe()
    expect(removeListener).toHaveBeenCalledWith(TERMINAL_AUTHORITY_APP_PROJECTION_EVENT, listener)

    const request = {
      version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
      subscriptionIncarnationId: 'renderer-1',
      expectedSubscriptionIncarnationId: null
    }
    await expect(api.pty.subscribeAuthorityProjection(request)).resolves.toEqual(snapshot)
    const clear = {
      version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
      consumerId: row.consumerId,
      namespace: row.namespace,
      pane: row.pane,
      expectedEvent: {
        consumerId: row.consumerId,
        namespace: row.namespace,
        sequence: 1,
        outcomeId: 'bell-1'
      }
    }
    await expect(api.pty.clearAuthorityProjectionBell(clear)).resolves.toBe(true)
    expect(invoke).toHaveBeenLastCalledWith(TERMINAL_AUTHORITY_APP_PROJECTION_CLEAR_BELL, clear)
  })
})

function projectionRow(): TerminalAuthorityAppPaneProjection {
  const binding = {
    ownerIncarnationId: 'owner-1',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: 'pty-incarnation-1'
  }
  return {
    version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
    consumerId: 'app-profile:test',
    namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
    pane: {
      paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
      paneGenerationId: 'pane-generation-1'
    },
    layout: { tabId: 'tab-1', leafId: '11111111-1111-4111-8111-111111111111' },
    binding,
    topology: {
      status: 'open',
      binding,
      lastBinding: binding,
      authorityRevision: 1,
      ownerStatus: 'reachable'
    },
    attention: { event: null, pendingBellCount: 0, updatedAt: 1 },
    status: { event: null, pane: 'open', agent: null, attention: false, updatedAt: 1 },
    facts: {}
  }
}
