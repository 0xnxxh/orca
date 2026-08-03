import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import * as Clipboard from 'expo-clipboard'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileTerminalPaste } from './use-mobile-terminal-paste'

vi.mock('expo-clipboard', () => ({
  getImageAsync: vi.fn(),
  getStringAsync: vi.fn()
}))
vi.mock('expo-file-system', () => ({
  File: class {},
  Paths: { cache: '/tmp' }
}))
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: vi.fn() },
  SaveFormat: { PNG: 'png' }
}))

describe('useMobileTerminalPaste', () => {
  let renderer: ReactTestRenderer | null = null
  let errorSpy: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(() => {
    const original = console.error
    errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
        return
      }
      original(...(args as Parameters<typeof console.error>))
    })
    vi.mocked(Clipboard.getStringAsync).mockResolvedValue('clipboard text')
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    errorSpy?.mockRestore()
    vi.clearAllMocks()
  })

  it('surfaces cancellation when marked-text waiting invalidates the original target', async () => {
    const sendRequest = vi.fn()
    const client = { sendRequest } as unknown as RpcClient
    const flushPendingLiveInputBeforeExternalSend = vi.fn(async () => false)
    const onError = vi.fn()
    const showToast = vi.fn()
    let paste: () => Promise<void> = async () => undefined

    function Probe(): null {
      paste = useMobileTerminalPaste({
        activeHandle: 'terminal-a',
        activeHandleRef: { current: 'terminal-a' },
        activeSessionTabTypeRef: { current: 'terminal' },
        canSend: true,
        client,
        clientRef: { current: client },
        connState: 'connected',
        connStateRef: { current: 'connected' },
        deviceTokenRef: { current: null },
        flushPendingLiveInputBeforeExternalSend,
        getActiveWorktreeConnectionId: async () => null,
        onError,
        onSuccess: vi.fn(),
        ptyModesRef: { current: new Map() },
        refreshCanPaste: vi.fn(),
        showToast
      })
      return null
    }

    act(() => {
      renderer = create(createElement(Probe))
    })
    await paste()

    expect(flushPendingLiveInputBeforeExternalSend).toHaveBeenCalledWith('terminal-a')
    expect(sendRequest).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
    expect(showToast).toHaveBeenCalledWith('Paste canceled before send', 1500)
  })
})
