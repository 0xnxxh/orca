import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, handleMock, isTrustedUIRendererMock } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handleMock: vi.fn(),
  isTrustedUIRendererMock: vi.fn(() => true)
}))

vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }))
vi.mock('./ui', () => ({ isTrustedUIRenderer: isTrustedUIRendererMock }))

import { registerMacosPtyLimitHandlers } from './macos-pty-limit'

describe('registerMacosPtyLimitHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    handleMock.mockReset().mockImplementation((channel, handler) => handlers.set(channel, handler))
    isTrustedUIRendererMock.mockReset().mockReturnValue(true)
  })

  it('routes status and increase requests without renderer arguments', async () => {
    const service = {
      getStatus: vi.fn().mockResolvedValue({ state: 'available', currentLimit: 511 }),
      increaseToMaximum: vi.fn().mockResolvedValue({ outcome: 'increased' })
    }
    registerMacosPtyLimitHandlers(service as never)
    const event = { sender: { id: 7 } }

    await expect(handlers.get('macosPtyLimit:getStatus')?.(event)).resolves.toMatchObject({
      state: 'available'
    })
    await expect(handlers.get('macosPtyLimit:increase')?.(event)).resolves.toMatchObject({
      outcome: 'increased'
    })
    expect(service.getStatus).toHaveBeenCalledWith()
    expect(service.increaseToMaximum).toHaveBeenCalledWith()
  })

  it('rejects untrusted renderers before reaching the service', () => {
    const service = { getStatus: vi.fn(), increaseToMaximum: vi.fn() }
    isTrustedUIRendererMock.mockReturnValue(false)
    registerMacosPtyLimitHandlers(service as never)
    const event = { sender: { id: 99 } }

    expect(() => handlers.get('macosPtyLimit:getStatus')?.(event)).toThrow(
      'Unauthorized macOS PTY limit IPC sender'
    )
    expect(() => handlers.get('macosPtyLimit:increase')?.(event)).toThrow(
      'Unauthorized macOS PTY limit IPC sender'
    )
    expect(service.getStatus).not.toHaveBeenCalled()
    expect(service.increaseToMaximum).not.toHaveBeenCalled()
  })
})
