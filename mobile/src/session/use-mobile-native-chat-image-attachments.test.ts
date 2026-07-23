import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse, RpcSuccess } from '../transport/types'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'

// Fully stub the picker so the real expo/react-native chain never loads under
// the vitest transform (react-native ships Flow syntax rolldown can't parse).
vi.mock('./mobile-image-source-picker', () => ({
  pickMobileImage: vi.fn(),
  ImageLibraryPermissionError: class ImageLibraryPermissionError extends Error {}
}))

import { pickMobileImage } from './mobile-image-source-picker'

const pick = vi.mocked(pickMobileImage)

function ok(id: string, result: unknown): RpcSuccess {
  return { id, ok: true, result, _meta: { runtimeId: 'r' } }
}
function methodNotFound(id: string): RpcResponse {
  return {
    id,
    ok: false,
    error: { code: 'method_not_found', message: 'no' },
    _meta: { runtimeId: 'r' }
  }
}
function sendResult(accepted: boolean): RpcSuccess {
  return { id: 'send', ok: true, result: { send: { accepted } }, _meta: { runtimeId: 'r' } }
}

function makeClient(responses: RpcResponse[]): Pick<RpcClient, 'sendRequest'> & {
  calls: { method: string; params: Record<string, unknown> }[]
} {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  return {
    calls,
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params: params as Record<string, unknown> })
      const response = responses.shift()
      if (!response) {
        throw new Error(`unexpected request: ${method}`)
      }
      return response
    })
  }
}

type HookArgs = Parameters<typeof useMobileNativeChatImageAttachments>[0]
type Hook = ReturnType<typeof useMobileNativeChatImageAttachments>

const SCOPE_A = 'h\0w\0tab-a'

function baseArgs(overrides: Partial<HookArgs> & Pick<HookArgs, 'client'>): HookArgs {
  return {
    activeHandleRef: { current: 'term-1' },
    deviceTokenRef: { current: null },
    getActiveWorktreeConnectionId: async () => null,
    connState: 'connected',
    scopeKey: SCOPE_A,
    enabled: true,
    showToast: vi.fn(),
    baseSend: vi.fn().mockResolvedValue(true),
    sleep: async () => {},
    ...overrides
  }
}

describe('useMobileNativeChatImageAttachments', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null

  function Harness({ args }: { args: HookArgs }): null {
    hook = useMobileNativeChatImageAttachments(args)
    return null
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    pick.mockReset()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  function mount(args: HookArgs): void {
    const original = console.error
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => {
      if (typeof a[0] === 'string' && a[0].includes('react-test-renderer is deprecated')) {
        return
      }
      original(...a)
    })
    try {
      act(() => {
        renderer = create(createElement(Harness, { args }))
      })
    } finally {
      spy.mockRestore()
    }
  }

  function update(args: HookArgs): void {
    act(() => {
      renderer!.update(createElement(Harness, { args }))
    })
  }

  it('adds an uploaded image as a chip without pasting to the terminal', async () => {
    pick.mockResolvedValue({ base64: 'AAAA', uri: 'file:///a.jpg' })
    const client = makeClient([methodNotFound('start'), ok('save', '/tmp/a.png')])
    mount(
      baseArgs({
        client: client as unknown as RpcClient,
        deviceTokenRef: { current: 'device-1' },
        getActiveWorktreeConnectionId: async () => 'conn-1'
      })
    )

    await act(async () => {
      await hook!.attachImage('library')
    })

    expect(hook!.attachments).toEqual([
      { id: 'img-1', path: '/tmp/a.png', previewUri: 'file:///a.jpg' }
    ])
    expect(client.calls.some((c) => c.method === 'terminal.send')).toBe(false)
  })

  it('rides pending images along on send: pastes the path, settles, then delegates the text', async () => {
    pick.mockResolvedValue({ base64: 'AAAA', uri: 'file:///a.jpg' })
    const client = makeClient([
      methodNotFound('start'),
      ok('save', '/tmp/a.png'),
      sendResult(true), // Ctrl+U clear
      sendResult(true) // the image paste (enter:false)
    ])
    const order: string[] = []
    const sleep = vi.fn(async () => {
      order.push('settle')
    })
    const baseSend = vi.fn(async (t: string) => {
      order.push(`text:${t}`)
      return true
    })
    mount(
      baseArgs({
        client: client as unknown as RpcClient,
        deviceTokenRef: { current: 'device-1' },
        baseSend,
        sleep
      })
    )

    await act(async () => {
      await hook!.attachImage('library')
    })

    let accepted = false
    await act(async () => {
      accepted = await hook!.sendNativeChat('look at this')
    })

    expect(accepted).toBe(true)
    const sendCalls = client.calls.filter((c) => c.method === 'terminal.send')
    // Ctrl+U clear, then the bracketed image paste.
    expect(sendCalls).toHaveLength(2)
    expect(sendCalls[0]?.params).toMatchObject({ text: '\x15', enter: false })
    expect(sendCalls[1]?.params).toMatchObject({
      text: '\x1b[200~/tmp/a.png\x1b[201~',
      enter: false
    })
    // Paste happens before the settle, which happens before the text send.
    expect(order).toEqual(['settle', 'text:look at this'])
    // The local preview URI rides along so the sent bubble shows the photo.
    expect(baseSend).toHaveBeenCalledWith('look at this', ['file:///a.jpg'])
    // Chips clear once the send is accepted.
    expect(hook!.attachments).toEqual([])
  })

  it('routes an attachments-only send through baseSend with empty text so the echo still shows the photo', async () => {
    pick.mockResolvedValue({ base64: 'AAAA', uri: 'file:///a.jpg' })
    const client = makeClient([
      methodNotFound('start'),
      ok('save', '/tmp/a.png'),
      sendResult(true), // Ctrl+U clear
      sendResult(true) // image paste
    ])
    const baseSend = vi.fn().mockResolvedValue(true)
    mount(baseArgs({ client: client as unknown as RpcClient, baseSend }))

    await act(async () => {
      await hook!.attachImage('library')
    })
    let accepted = false
    await act(async () => {
      accepted = await hook!.sendNativeChat('')
    })

    expect(accepted).toBe(true)
    // Empty text still goes through baseSend (which submits the bare Enter) so the
    // optimistic echo carries the preview URI.
    expect(baseSend).toHaveBeenCalledWith('', ['file:///a.jpg'])
    const sendCalls = client.calls.filter((c) => c.method === 'terminal.send')
    // Only the clear + image paste hit the wire here; baseSend owns the submit.
    expect(sendCalls).toHaveLength(2)
    expect(hook!.attachments).toEqual([])
  })

  it('delegates straight to baseSend when there are no attachments', async () => {
    const client = makeClient([])
    const baseSend = vi.fn().mockResolvedValue(true)
    mount(baseArgs({ client: client as unknown as RpcClient, baseSend }))

    await act(async () => {
      await hook!.sendNativeChat('just text')
    })
    expect(baseSend).toHaveBeenCalledWith('just text')
    expect(client.calls).toHaveLength(0)
  })

  it('keeps the chips and does not submit when the image paste is rejected', async () => {
    pick.mockResolvedValue({ base64: 'AAAA', uri: 'file:///a.jpg' })
    const client = makeClient([
      methodNotFound('start'),
      ok('save', '/tmp/a.png'),
      sendResult(true), // Ctrl+U clear
      sendResult(false) // image paste rejected
    ])
    const baseSend = vi.fn().mockResolvedValue(true)
    const showToast = vi.fn()
    mount(baseArgs({ client: client as unknown as RpcClient, baseSend, showToast }))
    await act(async () => {
      await hook!.attachImage('library')
    })
    let accepted = true
    await act(async () => {
      accepted = await hook!.sendNativeChat('hi')
    })
    expect(accepted).toBe(false)
    expect(baseSend).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Message not sent', 1500)
    expect(hook!.attachments).toHaveLength(1)
  })

  it('keeps the chips and reports failure when the paste transport throws', async () => {
    pick.mockResolvedValue({ base64: 'AAAA', uri: 'file:///a.jpg' })
    // No terminal.send responses queued: the clear write throws (dropped transport).
    const client = makeClient([methodNotFound('start'), ok('save', '/tmp/a.png')])
    const baseSend = vi.fn().mockResolvedValue(true)
    const showToast = vi.fn()
    mount(baseArgs({ client: client as unknown as RpcClient, baseSend, showToast }))
    await act(async () => {
      await hook!.attachImage('library')
    })
    let accepted = true
    await act(async () => {
      accepted = await hook!.sendNativeChat('hi')
    })
    expect(accepted).toBe(false)
    expect(baseSend).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Message not sent', 1500)
    expect(hook!.attachments).toHaveLength(1)
  })

  it('surfaces a toast instead of a silent no-op when the input lease gate is closed', async () => {
    pick.mockResolvedValue({ base64: 'AAAA', uri: 'file:///a.jpg' })
    const client = makeClient([methodNotFound('start'), ok('save', '/tmp/a.png')])
    const baseSend = vi.fn().mockResolvedValue(true)
    const showToast = vi.fn()
    // Attaching is allowed without the lease; only the send is gated on it.
    mount(baseArgs({ client: client as unknown as RpcClient, enabled: false, baseSend, showToast }))
    await act(async () => {
      await hook!.attachImage('library')
    })
    let accepted = true
    await act(async () => {
      accepted = await hook!.sendNativeChat('hi')
    })
    expect(accepted).toBe(false)
    expect(baseSend).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Message not sent (disconnected)', 1500)
    expect(hook!.attachments).toHaveLength(1)
  })

  it('scopes chips to the tab that attached them', async () => {
    pick.mockResolvedValue({ base64: 'AAAA', uri: 'file:///a.jpg' })
    const client = makeClient([methodNotFound('start'), ok('save', '/tmp/a.png')])
    const baseSend = vi.fn().mockResolvedValue(true)
    const args = baseArgs({ client: client as unknown as RpcClient, baseSend })
    mount(args)
    await act(async () => {
      await hook!.attachImage('library')
    })
    expect(hook!.attachments).toHaveLength(1)

    // Another tab sees no chip, and a send there is plain text — no image paste.
    update({ ...args, scopeKey: 'h\0w\0tab-b' })
    expect(hook!.attachments).toEqual([])
    await act(async () => {
      await hook!.sendNativeChat('hi')
    })
    expect(baseSend).toHaveBeenCalledWith('hi')
    expect(client.calls.some((c) => c.method === 'terminal.send')).toBe(false)

    // Back on the original tab the chip is still pending.
    update(args)
    expect(hook!.attachments).toHaveLength(1)
  })

  it('clears only the chips that were sent, keeping one attached mid-send', async () => {
    pick.mockResolvedValue({ base64: 'AAAA', uri: 'file:///a.jpg' })
    const client = makeClient([
      methodNotFound('start'),
      ok('save', '/tmp/a.png'), // first attach
      sendResult(true), // Ctrl+U clear
      sendResult(true), // first image paste
      methodNotFound('start'),
      ok('save', '/tmp/b.png') // second attach, while the send is parked on settle
    ])
    const baseSend = vi.fn().mockResolvedValue(true)
    let releaseSettle: (() => void) | null = null
    const args = baseArgs({
      client: client as unknown as RpcClient,
      baseSend,
      sleep: () =>
        new Promise<void>((resolve) => {
          releaseSettle = resolve
        })
    })
    mount(args)
    await act(async () => {
      await hook!.attachImage('library')
    })

    let sendPromise: Promise<boolean> | null = null
    await act(async () => {
      sendPromise = hook!.sendNativeChat('hi')
      // Drain microtasks until the send parks on the settle sleep.
      for (let i = 0; i < 50 && !releaseSettle; i++) {
        await Promise.resolve()
      }
    })
    expect(releaseSettle).not.toBeNull()

    pick.mockResolvedValue({ base64: 'BBBB', uri: 'file:///b.jpg' })
    await act(async () => {
      await hook!.attachImage('library')
    })
    await act(async () => {
      releaseSettle!()
      await sendPromise
    })

    // Only the first (sent) image rode along; the mid-send chip survives.
    expect(baseSend).toHaveBeenCalledWith('hi', ['file:///a.jpg'])
    expect(hook!.attachments.map((a) => a.previewUri)).toEqual(['file:///b.jpg'])
  })
})
