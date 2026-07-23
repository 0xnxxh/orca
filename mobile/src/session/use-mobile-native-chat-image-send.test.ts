import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import {
  NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS,
  NATIVE_CHAT_SUBMIT_DELAY_MS
} from '../../../src/shared/native-chat-answer-stepping'
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
let attachmentScopeKey = 'scope-1'

describe('useMobileNativeChatImageSend', () => {
  let renderer: ReactTestRenderer | null = null
  let send: ((text: string) => Promise<boolean>) | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    sendableImages = []
    leaseReady = true
    activeHandle = 'term-1'
    attachmentScopeKey = 'scope-1'
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
    vi.useRealTimers()
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
      attachmentScopeKey,
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

  function switchScope(scopeKey: string): void {
    attachmentScopeKey = scopeKey
    act(() => {
      renderer!.update(createElement(Harness))
    })
  }

  async function sendAndRunTimers(text: string): Promise<boolean> {
    const result = send!(text)
    await vi.runAllTimersAsync()
    return result
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

    await expect(sendAndRunTimers('what is this?')).resolves.toBe(true)
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

    await expect(sendAndRunTimers('')).resolves.toBe(true)
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

    await expect(sendAndRunTimers('caption')).resolves.toBe(false)
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

    await expect(sendAndRunTimers('caption')).resolves.toBe(false)
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

    await expect(sendAndRunTimers('caption')).resolves.toBe(false)
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

    await expect(sendAndRunTimers('caption')).resolves.toBe(false)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(markImagesPasted).toHaveBeenCalledWith(['a'])
    expect(sendText).not.toHaveBeenCalled()
  })

  it('does not resume an in-flight send after switching away and back to the same target', async () => {
    sendableImages = [{ id: 'a', status: 'ready', hostPath: '/tmp/a.png' }]
    let resolvePaste: (result: unknown) => void = () => {}
    sendRequest.mockReturnValue(
      new Promise((resolve) => {
        resolvePaste = resolve
      })
    )
    render()

    const sendResult = send!('caption')
    await vi.advanceTimersByTimeAsync(0)
    switchScope('scope-2')
    switchScope('scope-1')
    resolvePaste({ ok: true, result: { send: { accepted: true } } })

    await expect(sendResult).resolves.toBe(false)
    expect(markImagesPasted).toHaveBeenCalledWith(['a'])
    expect(sendText).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledWith('Message not sent (disconnected)')
  })

  it('preserves ambiguous image state without reporting definite failure or pasting twice', async () => {
    sendableImages = [{ id: 'a', status: 'ready', hostPath: '/tmp/a.png' }]
    sendRequest.mockRejectedValueOnce(markRpcDeliveryUnknown(new Error('ack lost')))
    render()

    await expect(sendAndRunTimers('caption')).resolves.toBe(true)
    expect(markImagesPasted).toHaveBeenCalledWith(['a'])
    expect(sendText).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledWith(
      'Image delivery unconfirmed — check terminal before retrying'
    )

    await expect(sendAndRunTimers('caption')).resolves.toBe(true)
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

    await expect(sendAndRunTimers('')).resolves.toBe(false)
    expect(sendableImages).toEqual([{ id: 'a', status: 'pasted' }])
    expect(consumeImages).not.toHaveBeenCalled()

    await expect(sendAndRunTimers('')).resolves.toBe(true)
    expect(sendRequest).toHaveBeenCalledTimes(3)
    expect(sendRequest).toHaveBeenNthCalledWith(3, 'terminal.send', {
      terminal: 'term-1',
      text: '',
      enter: true,
      client: { id: 'device-9', type: 'mobile' }
    })
    expect(consumeImages).toHaveBeenCalledWith(['a'])
  })

  it('waits for a newly pasted image to settle before sending its caption', async () => {
    sendableImages = [{ id: 'a', status: 'ready', hostPath: '/tmp/a.png' }]
    render()

    const sendResult = send!('caption')
    await vi.advanceTimersByTimeAsync(0)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(sendText).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS - 1)
    expect(sendText).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    await expect(sendResult).resolves.toBe(true)
    expect(sendText).toHaveBeenCalledWith('caption')
  })

  it('waits the normal submit gap before sending image-only Enter', async () => {
    sendableImages = [{ id: 'a', status: 'ready', hostPath: '/tmp/a.png' }]
    render()

    const sendResult = send!('')
    await vi.advanceTimersByTimeAsync(0)
    expect(sendRequest).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(NATIVE_CHAT_SUBMIT_DELAY_MS - 1)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)

    await expect(sendResult).resolves.toBe(true)
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('does not continue a delayed send or report against UI after unmount', async () => {
    sendableImages = [{ id: 'a', status: 'ready', hostPath: '/tmp/a.png' }]
    render()

    const sendResult = send!('caption')
    await vi.advanceTimersByTimeAsync(0)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    act(() => renderer!.unmount())
    renderer = null
    await vi.runAllTimersAsync()

    await expect(sendResult).resolves.toBe(false)
    expect(sendText).not.toHaveBeenCalled()
    expect(onSendError).not.toHaveBeenCalled()
  })
})
