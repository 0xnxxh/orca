import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreloadApi } from './api-types'
import type { SshConnectionState, SshProviderEpoch } from '../shared/ssh-types'

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

describe('native preload SSH authority forwarding', () => {
  const originalContextIsolated = Object.getOwnPropertyDescriptor(process, 'contextIsolated')

  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockReset()
    invoke.mockReset()
    on.mockReset()
    removeListener.mockReset()
    send.mockReset()
    sendSync.mockReset()
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

  it('forwards full-pair get and push states without cloning away authority', async () => {
    const state: SshConnectionState = {
      targetId: 'ssh-1',
      status: 'connected',
      error: null,
      reconnectAttempt: 0,
      providerEpoch: 'native-provider-epoch' as SshProviderEpoch,
      connectionGeneration: 29
    }
    invoke.mockResolvedValueOnce(state)
    await import('./index')
    const api = exposeInMainWorld.mock.calls.find(([name]) => name === 'api')?.[1] as PreloadApi

    await expect(api.ssh.getState({ targetId: 'ssh-1' })).resolves.toBe(state)
    expect(invoke).toHaveBeenCalledWith('ssh:getState', { targetId: 'ssh-1' })

    const onStateChanged = vi.fn()
    api.ssh.onStateChanged(onStateChanged)
    const listener = on.mock.calls.find(([channel]) => channel === 'ssh:state-changed')?.[1] as (
      event: unknown,
      data: { targetId: string; state: SshConnectionState }
    ) => void
    listener({}, { targetId: 'ssh-1', state })

    expect(onStateChanged).toHaveBeenCalledWith({ targetId: 'ssh-1', state })
    expect(onStateChanged.mock.calls[0]?.[0].state).toBe(state)
  })

  it('does not synthesize the missing half of partial compatibility states', async () => {
    const partialState = {
      targetId: 'ssh-1',
      status: 'connected',
      error: null,
      reconnectAttempt: 0,
      providerEpoch: 'partial-provider-epoch'
    } as SshConnectionState
    invoke.mockResolvedValueOnce(partialState)
    await import('./index')
    const api = exposeInMainWorld.mock.calls.find(([name]) => name === 'api')?.[1] as PreloadApi

    const returned = await api.ssh.getState({ targetId: 'ssh-1' })
    expect(returned).toBe(partialState)
    expect(returned).not.toHaveProperty('connectionGeneration')

    const onStateChanged = vi.fn()
    api.ssh.onStateChanged(onStateChanged)
    const listener = on.mock.calls.find(([channel]) => channel === 'ssh:state-changed')?.[1] as (
      event: unknown,
      data: { targetId: string; state: SshConnectionState }
    ) => void
    listener({}, { targetId: 'ssh-1', state: partialState })

    expect(onStateChanged.mock.calls[0]?.[0].state).toBe(partialState)
    expect(onStateChanged.mock.calls[0]?.[0].state).not.toHaveProperty('connectionGeneration')
  })
})
