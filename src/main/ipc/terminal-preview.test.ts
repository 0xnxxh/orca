import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, ipcMainMock } = vi.hoisted(() => {
  const map = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers: map,
    ipcMainMock: {
      removeHandler: vi.fn(),
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => map.set(channel, fn)
    }
  }
})

vi.mock('electron', () => ({ ipcMain: ipcMainMock }))

import { registerTerminalPreviewHandlers } from './terminal-preview'

type Listener = (data: string) => void

function makeRuntime() {
  const listeners: Listener[] = []
  const unsubscribe = vi.fn()
  return {
    listeners,
    unsubscribe,
    serializeTerminalBuffer: vi.fn(async () => ({ data: 'screen', cols: 80, rows: 20 })),
    subscribeToTerminalData: vi.fn((_ptyId: string, listener: Listener) => {
      listeners.push(listener)
      return unsubscribe
    }),
    writeTerminalPreviewInput: vi.fn(async () => true)
  }
}

function makeSender() {
  const destroyedListeners: (() => void)[] = []
  return {
    id: 1,
    isDestroyed: () => false,
    send: vi.fn(),
    once: (event: string, cb: () => void) => {
      if (event === 'destroyed') {
        destroyedListeners.push(cb)
      }
    },
    fireDestroyed: () => destroyedListeners.forEach((cb) => cb())
  }
}

describe('registerTerminalPreviewHandlers', () => {
  beforeEach(() => handlers.clear())
  afterEach(() => vi.clearAllMocks())

  it('serves a snapshot from the runtime', async () => {
    const runtime = makeRuntime()
    registerTerminalPreviewHandlers(runtime as never)
    const result = await handlers.get('terminalPreview:snapshot')!({} as never, {
      ptyId: 'p1',
      opts: { scrollbackRows: 24 }
    })
    expect(runtime.serializeTerminalBuffer).toHaveBeenCalledWith('p1', { scrollbackRows: 24 })
    expect(result).toEqual({ data: 'screen', cols: 80, rows: 20 })
  })

  it('forwards streamed chunks to the subscribing window', () => {
    const runtime = makeRuntime()
    registerTerminalPreviewHandlers(runtime as never)
    const sender = makeSender()
    handlers.get('terminalPreview:subscribe')!({ sender } as never, { ptyId: 'p1' })
    expect(runtime.subscribeToTerminalData).toHaveBeenCalledWith('p1', expect.any(Function))
    runtime.listeners[0]('hello')
    expect(sender.send).toHaveBeenCalledWith('terminalPreview:data', { ptyId: 'p1', data: 'hello' })
  })

  it('does not double-subscribe the same pty for one window', () => {
    const runtime = makeRuntime()
    registerTerminalPreviewHandlers(runtime as never)
    const sender = makeSender()
    handlers.get('terminalPreview:subscribe')!({ sender } as never, { ptyId: 'p1' })
    handlers.get('terminalPreview:subscribe')!({ sender } as never, { ptyId: 'p1' })
    expect(runtime.subscribeToTerminalData).toHaveBeenCalledTimes(1)
  })

  it('passes keystrokes through to the runtime', async () => {
    const runtime = makeRuntime()
    registerTerminalPreviewHandlers(runtime as never)
    const result = await handlers.get('terminalPreview:input')!({} as never, {
      ptyId: 'p1',
      data: 'ls\r'
    })
    expect(runtime.writeTerminalPreviewInput).toHaveBeenCalledWith('p1', 'ls\r')
    expect(result).toBe(true)
  })

  it('rejects malformed input payloads without touching the runtime', async () => {
    const runtime = makeRuntime()
    registerTerminalPreviewHandlers(runtime as never)
    const result = await handlers.get('terminalPreview:input')!({} as never, {
      ptyId: '',
      data: 'x'
    })
    expect(result).toBe(false)
    expect(runtime.writeTerminalPreviewInput).not.toHaveBeenCalled()
  })

  it('disposes the subscription on unsubscribe', () => {
    const runtime = makeRuntime()
    registerTerminalPreviewHandlers(runtime as never)
    const sender = makeSender()
    handlers.get('terminalPreview:subscribe')!({ sender } as never, { ptyId: 'p1' })
    handlers.get('terminalPreview:unsubscribe')!({ sender } as never, { ptyId: 'p1' })
    expect(runtime.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('disposes all of a window’s subscriptions when it is destroyed', () => {
    const runtime = makeRuntime()
    registerTerminalPreviewHandlers(runtime as never)
    const sender = makeSender()
    handlers.get('terminalPreview:subscribe')!({ sender } as never, { ptyId: 'p1' })
    sender.fireDestroyed()
    expect(runtime.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
