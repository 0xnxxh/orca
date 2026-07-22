import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatImageSend } from './use-mobile-native-chat-image-send'
import type { MobileNativeChatReadyImage } from './use-mobile-native-chat-pending-images'

const sendRequest = vi.fn()
const client = { sendRequest } as unknown as RpcClient
const sendText = vi.fn()
const consumeImages = vi.fn()
const onSendError = vi.fn()

let readyImages: readonly MobileNativeChatReadyImage[] = []
let leaseReady = true

describe('useMobileNativeChatImageSend', () => {
  let renderer: ReactTestRenderer | null = null
  let send: ((text: string) => Promise<boolean>) | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    readyImages = []
    leaseReady = true
    sendRequest.mockResolvedValue({ ok: true, result: { send: { accepted: true } } })
    sendText.mockResolvedValue(true)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    send = null
  })

  function Harness(): null {
    send = useMobileNativeChatImageSend({
      clientRef: { current: client },
      activeHandleRef: { current: 'term-1' },
      deviceTokenRef: { current: 'device-9' },
      inputLeaseReadyRef: {
        get current() {
          return leaseReady
        }
      },
      sendText,
      getReadyImages: () => readyImages,
      consumeImages,
      onSendError
    })
    return null
  }

  function render(): void {
    act(() => {
      renderer = create(createElement(Harness))
    })
  }

  it('passes straight through to the text send when no images are pending', async () => {
    render()
    await expect(send!('hello')).resolves.toBe(true)
    expect(sendText).toHaveBeenCalledWith('hello')
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('pastes each image bracketed without enter, consumes it, then sends the text', async () => {
    readyImages = [
      { id: 'a', hostPath: '/tmp/a.png' },
      { id: 'b', hostPath: '/tmp/b.png' }
    ]
    render()

    await expect(send!('what is this?')).resolves.toBe(true)
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(sendRequest).toHaveBeenNthCalledWith(1, 'terminal.send', {
      terminal: 'term-1',
      text: '\x1b[200~/tmp/a.png\x1b[201~',
      enter: false,
      client: { id: 'device-9', type: 'mobile' }
    })
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'terminal.send', {
      terminal: 'term-1',
      text: '\x1b[200~/tmp/b.png\x1b[201~',
      enter: false,
      client: { id: 'device-9', type: 'mobile' }
    })
    expect(consumeImages.mock.calls).toEqual([[['a']], [['b']]])
    expect(sendText).toHaveBeenCalledWith('what is this?')
  })

  it('submits an image-only send with a bare Enter', async () => {
    readyImages = [{ id: 'a', hostPath: '/tmp/a.png' }]
    render()

    await expect(send!('')).resolves.toBe(true)
    expect(sendText).not.toHaveBeenCalled()
    expect(sendRequest).toHaveBeenLastCalledWith('terminal.send', {
      terminal: 'term-1',
      text: '',
      enter: true,
      client: { id: 'device-9', type: 'mobile' }
    })
  })

  it('stops and keeps undelivered images when a paste is rejected', async () => {
    readyImages = [
      { id: 'a', hostPath: '/tmp/a.png' },
      { id: 'b', hostPath: '/tmp/b.png' }
    ]
    sendRequest
      .mockResolvedValueOnce({ ok: true, result: { send: { accepted: true } } })
      .mockResolvedValueOnce({ ok: true, result: { send: { accepted: false } } })
    render()

    await expect(send!('caption')).resolves.toBe(false)
    // Only the delivered image is consumed; 'b' stays attached for retry.
    expect(consumeImages.mock.calls).toEqual([[['a']]])
    expect(sendText).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledWith('Message not sent')
  })

  it('fails before pasting anything when the input lease is not ready', async () => {
    readyImages = [{ id: 'a', hostPath: '/tmp/a.png' }]
    leaseReady = false
    render()

    await expect(send!('caption')).resolves.toBe(false)
    expect(sendRequest).not.toHaveBeenCalled()
    expect(consumeImages).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledWith('Message not sent (disconnected)')
  })
})
