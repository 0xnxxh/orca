import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse, RpcSuccess } from '../transport/types'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'

vi.mock('./mobile-image-source-picker', () => ({
  pickMobileImage: vi.fn(),
  ImageLibraryPermissionError: class ImageLibraryPermissionError extends Error {}
}))

import { pickMobileImage } from './mobile-image-source-picker'

const pick = vi.mocked(pickMobileImage)
type Hook = ReturnType<typeof useMobileNativeChatImageAttachments>
type HookArgs = Parameters<typeof useMobileNativeChatImageAttachments>[0]

function success(id: string, result: unknown): RpcSuccess {
  return { id, ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function unavailable(id: string): RpcResponse {
  return {
    id,
    ok: false,
    error: { code: 'method_not_found', message: 'unavailable' },
    _meta: { runtimeId: 'runtime-1' }
  }
}

describe('useMobileNativeChatImageAttachments Stop ordering', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null
  const responses: RpcResponse[] = []
  const sendRequest = vi.fn(async () => {
    const response = responses.shift()
    if (!response) {
      throw new Error('unexpected request')
    }
    return response
  })

  function Harness({ args }: { args: HookArgs }): null {
    hook = useMobileNativeChatImageAttachments(args)
    return null
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    responses.splice(
      0,
      responses.length,
      unavailable('upload-start'),
      success('upload-save', '/tmp/image.png'),
      success('clear', { send: { accepted: true } }),
      success('paste', { send: { accepted: true } })
    )
    pick.mockResolvedValue({ base64: 'AAAA', uri: 'file:///image.jpg' })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  it('waits for Stop before the first image paste write', async () => {
    let releaseWrite!: (allowed: boolean) => void
    const beforeWrite = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          releaseWrite = resolve
        })
    )
    const baseSend = vi.fn().mockResolvedValue('accepted')
    const args: HookArgs = {
      client: { sendRequest } as unknown as RpcClient,
      activeHandleRef: { current: 'terminal-1' },
      deviceTokenRef: { current: 'mobile-1' },
      getActiveWorktreeConnectionId: async () => null,
      connState: 'connected',
      scopeKey: 'host\0worktree\0tab',
      enabled: true,
      showToast: vi.fn(),
      onSendError: vi.fn(),
      baseSend,
      beforeWrite,
      readSeededLaunchDraft: () => null,
      sleep: async () => {}
    }
    const original = console.error
    const spy = vi.spyOn(console, 'error').mockImplementation((...messages) => {
      if (
        typeof messages[0] === 'string' &&
        messages[0].includes('react-test-renderer is deprecated')
      ) {
        return
      }
      original(...messages)
    })
    try {
      act(() => {
        renderer = create(createElement(Harness, { args }))
      })
    } finally {
      spy.mockRestore()
    }
    await act(async () => hook!.attachImage('library'))

    let send!: Promise<boolean>
    act(() => {
      send = hook!.sendNativeChat('look')
    })
    await Promise.resolve()
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(baseSend).not.toHaveBeenCalled()

    await act(async () => releaseWrite(true))
    await expect(send).resolves.toBe(true)
    expect(sendRequest).toHaveBeenCalledTimes(4)
    expect(baseSend).toHaveBeenCalledWith('look', ['file:///image.jpg'], expect.any(Number))
  })
})
