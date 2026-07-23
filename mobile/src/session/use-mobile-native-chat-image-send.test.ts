import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { useMobileNativeChatImageSend } from './use-mobile-native-chat-image-send'
import type { MobileNativeChatSendImage } from './use-mobile-native-chat-pending-images'

const sendRequest = vi.fn()
const client = { sendRequest } as unknown as RpcClient
const sendText = vi.fn()
const markImagesPasted = vi.fn()
const consumeImages = vi.fn()
const onSendError = vi.fn()

let sendableImages: MobileNativeChatSendImage[] = []
let leaseReady = true
let activeHandle = 'term-1'

describe('useMobileNativeChatImageSend', () => {
  let renderer: ReactTestRenderer | null = null
  let send: ((text: string) => Promise<boolean>) | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    sendableImages = []
    leaseReady = true
    activeHandle = 'term-1'
    sendRequest.mockResolvedValue({ ok: true, result: { send: { accepted: true } } })
    sendText.mockResolvedValue(true)
    markImagesPasted.mockImplementation((ids: readonly string[]) => {
      const pasted = new Set(ids)
      sendableImages = sendableImages.map((image) =>
        pasted.has(image.id) ? { id: image.id, status: 'pasted' } : image
      )
    })
    consumeImages.mockImplementation((ids: readonly string[]) => {
      const consumed = new Set(ids)
      sendableImages = sendableImages.filter((image) => !consumed.has(image.id))
    })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    send = null
  })

  function Harness(): null {
    send = useMobileNativeChatImageSend({
      clientRef: { current: client },
      activeHandleRef: {
        get current() {
          return activeHandle
        }
      },
      deviceTokenRef: { current: 'device-9' },
      inputLeaseReadyRef: {
        get current() {
          return leaseReady
        }
      },
      sendText,
      getSendableImages: () => sendableImages,
      markImagesPasted,
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
    sendableImages = [
      { id: 'a', status: 'ready', hostPath: '/tmp/a.png' },
      { id: 'b', status: 'ready', hostPath: '/tmp/b.png' }
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
    expect(markImagesPasted.mock.calls).toEqual([[['a']], [['b']]])
    expect(consumeImages).toHaveBeenCalledWith(['a', 'b'])
    expect(sendText).toHaveBeenCalledWith('what is this?')
  })

  it('submits an image-only send with a bare Enter', async () => {
    sendableImages = [{ id: 'a', status: 'ready', hostPath: '/tmp/a.png' }]
    render()

    await expect(send!('')).resolves.toBe(true)
    expect(sendText).not.toHaveBeenCalled()
    expect(sendRequest).toHaveBeenLastCalledWith('terminal.send', {
      terminal: 'term-1',
      text: '',
      enter: true,
      client: { id: 'device-9', type: 'mobile' }
    })
    expect(consumeImages).toHaveBeenCalledWith(['a'])
  })

  it('stops and keeps undelivered images when a paste is rejected', async () => {
    sendableImages = [
      { id: 'a', status: 'ready', hostPath: '/tmp/a.png' },
      { id: 'b', status: 'ready', hostPath: '/tmp/b.png' }
    ]
    sendRequest
      .mockResolvedValueOnce({ ok: true, result: { send: { accepted: true } } })
      .mockResolvedValueOnce({ ok: true, result: { send: { accepted: false } } })
    render()

    await expect(send!('caption')).resolves.toBe(false)
    // The first path stays marked as pasted; retry must not write it again.
    expect(markImagesPasted).toHaveBeenCalledWith(['a'])
    expect(consumeImages).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledWith('Message not sent')
  })

  it('fails before pasting anything when the input lease is not ready', async () => {
    sendableImages = [{ id: 'a', status: 'ready', hostPath: '/tmp/a.png' }]
    leaseReady = false
    render()

    await expect(send!('caption')).resolves.toBe(false)
    expect(sendRequest).not.toHaveBeenCalled()
    expect(consumeImages).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledWith('Message not sent (disconnected)')
  })

  it('does not send the caption to a terminal selected while image paths were being pasted', async () => {
    sendableImages = [{ id: 'a', status: 'ready', hostPath: '/tmp/a.png' }]
    sendRequest.mockImplementation(async () => {
      activeHandle = 'term-2'
      return { ok: true, result: { send: { accepted: true } } }
    })
    render()

    await expect(send!('caption')).resolves.toBe(false)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(markImagesPasted).toHaveBeenCalledWith(['a'])
    expect(consumeImages).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledWith('Message not sent (disconnected)')
  })

  it('does not continue pasting images after the target terminal changes', async () => {
    sendableImages = [
      { id: 'a', status: 'ready', hostPath: '/tmp/a.png' },
      { id: 'b', status: 'ready', hostPath: '/tmp/b.png' }
    ]
    sendRequest.mockImplementation(async () => {
      activeHandle = 'term-2'
      return { ok: true, result: { send: { accepted: true } } }
    })
    render()

    await expect(send!('caption')).resolves.toBe(false)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(markImagesPasted).toHaveBeenCalledWith(['a'])
    expect(sendText).not.toHaveBeenCalled()
  })

  it('does not paste an image twice when its acknowledgement is lost', async () => {
    sendableImages = [{ id: 'a', status: 'ready', hostPath: '/tmp/a.png' }]
    sendRequest.mockRejectedValueOnce(markRpcDeliveryUnknown(new Error('ack lost')))
    render()

    await expect(send!('caption')).resolves.toBe(false)
    expect(markImagesPasted).toHaveBeenCalledWith(['a'])
    expect(sendText).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledWith(
      'Image delivery unconfirmed — check terminal before retrying'
    )

    await expect(send!('caption')).resolves.toBe(true)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(consumeImages).toHaveBeenCalledWith(['a'])
  })

  it('retries only the final Enter after an image-only submission is rejected', async () => {
    sendableImages = [{ id: 'a', status: 'ready', hostPath: '/tmp/a.png' }]
    sendRequest
      .mockResolvedValueOnce({ ok: true, result: { send: { accepted: true } } })
      .mockResolvedValueOnce({ ok: true, result: { send: { accepted: false } } })
      .mockResolvedValueOnce({ ok: true, result: { send: { accepted: true } } })
    render()

    await expect(send!('')).resolves.toBe(false)
    expect(sendableImages).toEqual([{ id: 'a', status: 'pasted' }])
    expect(consumeImages).not.toHaveBeenCalled()

    await expect(send!('')).resolves.toBe(true)
    expect(sendRequest).toHaveBeenCalledTimes(3)
    expect(sendRequest).toHaveBeenNthCalledWith(3, 'terminal.send', {
      terminal: 'term-1',
      text: '',
      enter: true,
      client: { id: 'device-9', type: 'mobile' }
    })
    expect(consumeImages).toHaveBeenCalledWith(['a'])
  })
})
