// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionWireRefusalCode } from '../../../../shared/agent-session-wire'

const mocks = vi.hoisted(() => ({
  call: vi.fn()
}))

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))

import { useStructuredAgentSessionOutbox } from './use-structured-agent-session-outbox'

const LOCAL_TARGET = { kind: 'local' } as const

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function acceptedResult(fence: number) {
  return {
    ok: true,
    replayed: false,
    fence,
    cursor: { epoch: 'epoch-1', sequence: fence },
    value: {
      clientMessageId: 'client-1',
      submission: {
        clientMessageId: 'client-1',
        fence,
        payloadFingerprint: 'fingerprint',
        dispatchState: 'accepted',
        providerItemId: 'provider-1',
        reason: null,
        submittedAt: fence,
        resolvedAt: fence
      }
    }
  }
}

function refusedResult(code: AgentSessionWireRefusalCode) {
  return { ok: false, refusal: { code, message: code } }
}

function unknownResult(clientMessageId: string) {
  return {
    ok: true,
    replayed: false,
    fence: 1,
    cursor: { epoch: 'epoch-1', sequence: 1 },
    value: {
      clientMessageId,
      submission: {
        clientMessageId,
        fence: 1,
        payloadFingerprint: 'fingerprint',
        dispatchState: 'unknown',
        providerItemId: null,
        reason: 'provider receipt missing',
        submittedAt: 1,
        resolvedAt: 1
      }
    }
  }
}

describe('useStructuredAgentSessionOutbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '11111111-1111-4111-8111-111111111111'
    )
  })

  it('requeues across a fence change and ignores the stale settlement', async () => {
    const first = deferred<ReturnType<typeof acceptedResult>>()
    const second = deferred<ReturnType<typeof acceptedResult>>()
    mocks.call.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result, rerender } = renderHook(
      ({ fence }) =>
        useStructuredAgentSessionOutbox({
          sessionId: 'session-1',
          target: LOCAL_TARGET,
          fence,
          submissions: []
        }),
      { initialProps: { fence: 1 } }
    )

    act(() => expect(result.current.send('hello')).toBe(true))
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(1))

    rerender({ fence: 2 })
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2))
    expect(mocks.call.mock.calls[1]?.[2]).toMatchObject({
      envelope: { expectedRuntimeFence: 2 }
    })

    await act(async () => first.resolve(acceptedResult(1)))
    expect(result.current.outbox).toHaveLength(1)

    await act(async () => second.resolve(acceptedResult(2)))
    await waitFor(() => expect(result.current.outbox).toHaveLength(0))
  })

  it.each(['agent_session_operation_conflict', 'agent_session_operation_expired'] as const)(
    'rotates a send operation after %s',
    async (code) => {
      vi.mocked(globalThis.crypto.randomUUID)
        .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
        .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
      mocks.call.mockResolvedValueOnce(refusedResult(code)).mockResolvedValueOnce(acceptedResult(1))
      const { result } = renderHook(() =>
        useStructuredAgentSessionOutbox({
          sessionId: 'session-1',
          target: LOCAL_TARGET,
          fence: 1,
          submissions: []
        })
      )

      act(() => expect(result.current.send('hello')).toBe(true))
      await waitFor(() => expect(result.current.outbox[0]?.state).toBe('queued'))
      const firstId = (mocks.call.mock.calls[0]![2] as { envelope: { clientOperationId: string } })
        .envelope.clientOperationId
      const retryId = result.current.outbox[0]!.clientMessageId
      expect(retryId).not.toBe(firstId)

      act(() => result.current.retry(retryId))
      await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2))
      expect(
        (mocks.call.mock.calls[1]![2] as { envelope: { clientOperationId: string } }).envelope
          .clientOperationId
      ).toBe(retryId)
    }
  )

  it('retains a send operation after a pending-admission refusal', async () => {
    mocks.call
      .mockResolvedValueOnce(refusedResult('agent_session_checkpoint_stale'))
      .mockResolvedValueOnce(acceptedResult(1))
    const { result } = renderHook(() =>
      useStructuredAgentSessionOutbox({
        sessionId: 'session-1',
        target: LOCAL_TARGET,
        fence: 1,
        submissions: []
      })
    )

    act(() => expect(result.current.send('hello')).toBe(true))
    await waitFor(() => expect(result.current.outbox[0]?.state).toBe('queued'))
    const firstId = (mocks.call.mock.calls[0]![2] as { envelope: { clientOperationId: string } })
      .envelope.clientOperationId
    expect(result.current.outbox[0]?.clientMessageId).toBe(firstId)

    act(() => result.current.retry(firstId))
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2))
    expect(
      (mocks.call.mock.calls[1]![2] as { envelope: { clientOperationId: string } }).envelope
        .clientOperationId
    ).toBe(firstId)
  })

  it('discards an unconfirmed head after restart and dispatches the queued message', async () => {
    vi.mocked(globalThis.crypto.randomUUID)
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    mocks.call
      .mockResolvedValueOnce(unknownResult('11111111-1111-4111-8111-111111111111'))
      .mockResolvedValueOnce(acceptedResult(1))
    const first = renderHook(() =>
      useStructuredAgentSessionOutbox({
        sessionId: 'session-1',
        target: LOCAL_TARGET,
        fence: 1,
        submissions: []
      })
    )

    act(() => expect(first.result.current.send('/permissions prompt')).toBe(true))
    await waitFor(() => expect(first.result.current.outbox[0]?.state).toBe('unconfirmed'))
    act(() => expect(first.result.current.send('send this next')).toBe(true))
    const staleId = first.result.current.outbox[0]!.clientMessageId
    first.unmount()

    const restarted = renderHook(() =>
      useStructuredAgentSessionOutbox({
        sessionId: 'session-1',
        target: LOCAL_TARGET,
        fence: 1,
        submissions: []
      })
    )
    expect(restarted.result.current.outbox).toHaveLength(2)
    act(() => restarted.result.current.discard(staleId))

    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2))
    expect(mocks.call.mock.calls[1]?.[2]).toMatchObject({
      body: { blocks: [{ type: 'text', text: 'send this next' }] }
    })
    await waitFor(() => expect(restarted.result.current.outbox).toHaveLength(0))
  })

  it('retries an unconfirmed slash command after restart without leaving a durable head', async () => {
    mocks.call
      .mockResolvedValueOnce(unknownResult('11111111-1111-4111-8111-111111111111'))
      .mockResolvedValueOnce(acceptedResult(1))
    const first = renderHook(() =>
      useStructuredAgentSessionOutbox({
        sessionId: 'session-1',
        target: LOCAL_TARGET,
        fence: 1,
        submissions: []
      })
    )

    act(() => expect(first.result.current.send('/permissions prompt')).toBe(true))
    await waitFor(() => expect(first.result.current.outbox[0]?.state).toBe('unconfirmed'))
    const staleId = first.result.current.outbox[0]!.clientMessageId
    first.unmount()

    const restarted = renderHook(() =>
      useStructuredAgentSessionOutbox({
        sessionId: 'session-1',
        target: LOCAL_TARGET,
        fence: 1,
        submissions: []
      })
    )
    act(() => restarted.result.current.retry(staleId))

    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(restarted.result.current.outbox).toHaveLength(0))
  })
})
