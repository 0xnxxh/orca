// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
})
