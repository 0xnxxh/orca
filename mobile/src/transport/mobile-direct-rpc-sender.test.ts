import { describe, expect, it, vi } from 'vitest'
import { createMobileDirectRpcSender } from './mobile-direct-rpc-sender'

describe('createMobileDirectRpcSender', () => {
  it('does not log rejected request content or error details', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const socket = { readyState: WebSocket.OPEN } as WebSocket
    const sender = createMobileDirectRpcSender({
      getOutbound: () => ({
        acknowledge: vi.fn(),
        acknowledgeAuthentication: vi.fn(),
        dispose: vi.fn(),
        enqueue() {
          const error = new Error('credential-secret /private/repository')
          error.name = 'credential-secret'
          throw error
        },
        socketClosed: vi.fn()
      }),
      getSharedKey: () => new Uint8Array(32),
      getSocket: () => socket,
      getState: () => 'connected',
      onSocketDesync: vi.fn()
    })

    expect(sender({ token: 'request-secret' })).toBe(false)
    const output = JSON.stringify(consoleWarn.mock.calls)
    expect(output).toContain('"kind":"error"')
    expect(output).not.toMatch(/credential-secret|private\/repository|request-secret/)
  })
})
