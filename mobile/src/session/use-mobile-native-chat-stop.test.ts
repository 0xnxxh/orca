import { createElement, useRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS } from './mobile-native-chat-send'
import { useMobileNativeChatStop } from './use-mobile-native-chat-stop'

describe('useMobileNativeChatStop', () => {
  let renderer: ReactTestRenderer | null = null
  let stop: (() => void) | null = null
  const sendRequest = vi.fn()
  const onSendError = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    sendRequest.mockReset().mockResolvedValue({
      ok: true,
      result: { send: { accepted: true } }
    })
    onSendError.mockReset()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    stop = null
    vi.useRealTimers()
  })

  function Harness({
    enabled,
    streamIdentity,
    agent
  }: {
    enabled: boolean
    streamIdentity: string
    agent: string
  }): null {
    const handleRef = useRef<string | null>('terminal-1')
    const deviceTokenRef = useRef<string | null>('mobile-1')
    const agentRef = useRef<string | null>(agent)
    agentRef.current = agent
    stop = useMobileNativeChatStop({
      client: { sendRequest } as unknown as RpcClient,
      enabled,
      handleRef,
      deviceTokenRef,
      agentRef,
      streamIdentity,
      cancelPending: vi.fn(),
      onSendError
    })
    return null
  }

  async function render(enabled: boolean, streamIdentity: string, agent = 'claude'): Promise<void> {
    await act(async () => {
      const element = createElement(Harness, { enabled, streamIdentity, agent })
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
  }

  it.each([
    ['the acknowledged input lease is lost', false, 'stream-1'],
    ['the active stream changes', true, 'stream-2']
  ])('cancels the delayed second Escape when %s', async (_case, enabled, streamIdentity) => {
    await render(true, 'stream-1')

    act(() => stop?.())
    expect(sendRequest).toHaveBeenCalledTimes(1)

    await render(enabled as boolean, streamIdentity as string)
    await act(async () => vi.runAllTimersAsync())

    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('handles a rejected Escape without leaking an unhandled rejection', async () => {
    sendRequest.mockRejectedValue(new Error('disconnected'))
    await render(true, 'stream-1')

    act(() => stop?.())
    await act(async () => {
      await Promise.resolve()
      await vi.runAllTimersAsync()
    })

    expect(onSendError).toHaveBeenCalledOnce()
    expect(onSendError).toHaveBeenCalledWith('Stop not sent')
  })

  it.each([
    ['RPC failure', { ok: false, error: { code: 'stale', message: 'stale' } }],
    ['non-accepted send', { ok: true, result: { send: { accepted: false } } }]
  ])('reports Stop not sent after a resolved %s', async (_case, response) => {
    sendRequest.mockResolvedValue(response)
    await render(true, 'stream-1')

    act(() => stop?.())
    await act(async () => vi.runAllTimersAsync())

    expect(onSendError).toHaveBeenCalledOnce()
    expect(onSendError).toHaveBeenCalledWith('Stop not sent')
  })

  it.each([
    [
      'an ack lost after the frame was written',
      () => markRpcDeliveryUnknown(new Error('rpc timeout'))
    ],
    ['a logical client cutover', () => new Error('RPC interrupted by connection migration')]
  ])('reports Stop as unconfirmed after %s', async (_case, makeError) => {
    sendRequest.mockRejectedValue(makeError())
    await render(true, 'stream-1')

    act(() => stop?.())
    await act(async () => {
      await Promise.resolve()
      await vi.runAllTimersAsync()
    })

    // The Escape may have landed; a definite "not sent" invites a second Escape.
    expect(onSendError).toHaveBeenCalledOnce()
    expect(onSendError).toHaveBeenCalledWith('Stop unconfirmed — check chat before retrying')
  })

  it.each([
    ['second', 0],
    ['first', 1]
  ])('stays quiet when the %s Escape fails after its sibling landed', async (_case, failIndex) => {
    let call = 0
    sendRequest.mockImplementation(() => {
      const index = call
      call += 1
      return index === failIndex
        ? Promise.reject(markRpcDeliveryUnknown(new Error('rpc timeout')))
        : Promise.resolve({ ok: true, result: { send: { accepted: true } } })
    })
    await render(true, 'stream-1')

    act(() => stop?.())
    await act(async () => {
      await Promise.resolve()
      await vi.runAllTimersAsync()
    })

    // Two paced Escapes are one user action: either landing means the agent stopped,
    // so a straggler's failure must not tell the user to press Stop again.
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(onSendError).not.toHaveBeenCalled()
  })

  it('bounds the Escape on a reconnect wait instead of parking forever', async () => {
    await render(true, 'stream-1')

    act(() => stop?.())

    // The budget covers the reconnect wait too, so a stop can't outlast its ceiling.
    expect(sendRequest).toHaveBeenCalledWith(
      'terminal.send',
      expect.anything(),
      expect.objectContaining({
        timeoutMs: MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS,
        budgetSpansConnect: true
      })
    )
  })

  it('stops acknowledged Codex background tools without closing the reusable session', async () => {
    let backgroundToolRunning = true
    let sessionRunning = true
    sendRequest.mockImplementation((method: string, params: { text?: string; enter?: boolean }) => {
      if (method === 'terminal.stop') {
        sessionRunning = false
      }
      if (params.text === '/stop' && params.enter === true) {
        backgroundToolRunning = false
      }
      return Promise.resolve({ ok: true, result: { send: { accepted: true } } })
    })
    await render(true, 'stream-1', 'codex')

    act(() => stop?.())
    await act(async () => vi.runAllTimersAsync())

    expect(sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'terminal.send',
      'terminal.send',
      'terminal.send'
    ])
    expect(sendRequest.mock.calls.map(([, params]) => params)).toEqual([
      expect.objectContaining({ text: '\x1b', enter: false }),
      expect.objectContaining({ text: '\x1b', enter: false }),
      expect.objectContaining({ text: '/stop', enter: true })
    ])
    expect(backgroundToolRunning).toBe(false)
    expect(sessionRunning).toBe(true)
  })

  it('leaves non-Codex Stop on the existing paced Escape path', async () => {
    await render(true, 'stream-1', 'claude')

    act(() => stop?.())
    await act(async () => vi.runAllTimersAsync())

    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(sendRequest.mock.calls.every(([, params]) => params.text === '\x1b')).toBe(true)
  })

  it('cancels Codex cleanup when the active agent changes after the interrupt', async () => {
    await render(true, 'stream-1', 'codex')

    act(() => stop?.())
    await act(async () => vi.advanceTimersByTimeAsync(80))
    expect(sendRequest).toHaveBeenCalledTimes(2)

    await render(true, 'stream-1', 'claude')
    await act(async () => vi.runAllTimersAsync())

    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('reports an acknowledged interrupt whose Codex tool cleanup is rejected', async () => {
    sendRequest.mockImplementation((_method: string, params: { text?: string }) =>
      Promise.resolve({
        ok: true,
        result: { send: { accepted: params.text !== '/stop' } }
      })
    )
    await render(true, 'stream-1', 'codex')

    act(() => stop?.())
    await act(async () => vi.runAllTimersAsync())

    expect(onSendError).toHaveBeenCalledOnce()
    expect(onSendError).toHaveBeenCalledWith(
      'Stop incomplete — send /stop to close background tools'
    )
  })

  it('suppresses an older Stop verdict after a newer Stop succeeds', async () => {
    let rejectFirst!: (error: Error) => void
    const first = new Promise((_, reject) => {
      rejectFirst = reject
    })
    sendRequest
      .mockReturnValueOnce(first)
      .mockResolvedValue({ ok: true, result: { send: { accepted: true } } })
    await render(true, 'stream-1')

    act(() => stop?.())
    act(() => stop?.())
    await act(async () => vi.runAllTimersAsync())
    await act(async () => {
      rejectFirst(new Error('late failure'))
      await Promise.resolve()
    })

    expect(onSendError).not.toHaveBeenCalled()
  })
})
