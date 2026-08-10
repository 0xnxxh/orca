import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import type { AgentJournalSubmission } from '../../../src/shared/agent-session-journal-types'
import type * as MobileStructuredOutboxStore from './mobile-structured-outbox-store'
import {
  loadMobileStructuredOutbox,
  saveMobileStructuredOutbox
} from './mobile-structured-outbox-store'
import {
  useMobileStructuredSessionWrites,
  type MobileStructuredSessionWrites
} from './use-mobile-structured-session-writes'

vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }))
vi.mock('./mobile-structured-outbox-store', async (importOriginal) => {
  const original = await importOriginal<typeof MobileStructuredOutboxStore>()
  return { ...original, loadMobileStructuredOutbox: vi.fn(), saveMobileStructuredOutbox: vi.fn() }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function accepted(id: string): RpcSuccess {
  return {
    id,
    ok: true,
    _meta: { runtimeId: 'runtime-1' },
    result: {
      ok: true,
      replayed: false,
      fence: 3,
      cursor: { epoch: 'epoch-1', sequence: 2 },
      value: {
        clientMessageId: id,
        submission: {
          clientMessageId: id,
          fence: 3,
          payloadFingerprint: 'a'.repeat(64),
          dispatchState: 'accepted',
          providerItemId: 'codex:thread:turn:0',
          reason: null,
          submittedAt: 1,
          resolvedAt: 2
        }
      }
    }
  }
}

describe('useMobileStructuredSessionWrites', () => {
  let renderer: ReactTestRenderer | null = null
  let api: MobileStructuredSessionWrites | null = null
  const sendRequest = vi.fn<RpcClient['sendRequest']>()
  const client = {
    sendRequest,
    getState: () => 'connected' as const
  } as RpcClient
  let connected = true
  let fence = 3
  let sessionId = 'mobile_1'
  let submissions: AgentJournalSubmission[] = []

  function Probe(): null {
    api = useMobileStructuredSessionWrites({
      client,
      connected,
      sessionId,
      fence,
      submissions
    })
    return null
  }

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.mocked(loadMobileStructuredOutbox).mockReset().mockResolvedValue([])
    vi.mocked(saveMobileStructuredOutbox).mockReset().mockResolvedValue(undefined)
    sendRequest.mockReset()
    connected = true
    fence = 3
    sessionId = 'mobile_1'
    submissions = []
    const crypto = await import('expo-crypto')
    vi.mocked(crypto.randomUUID)
      .mockReset()
      .mockReturnValue('00000000-0000-4000-8000-000000000099')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
    await act(async () => {
      renderer = create(createElement(Probe))
      await Promise.resolve()
    })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    api = null
  })

  it('persists before dispatch and allows only one in-flight send', async () => {
    const first = deferred<RpcSuccess>()
    sendRequest.mockImplementationOnce(() => first.promise).mockResolvedValueOnce(accepted('two'))

    await act(async () => {
      await api!.send('one')
      await api!.send('two')
      await Promise.resolve()
    })

    expect(saveMobileStructuredOutbox).toHaveBeenCalled()
    expect(sendRequest).toHaveBeenCalledTimes(1)
    const firstId = (sendRequest.mock.calls[0]![1] as { envelope: { clientOperationId: string } })
      .envelope.clientOperationId

    await act(async () => {
      first.resolve(accepted(firstId))
      await first.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('retries a durable unknown by the same id before dispatching later messages', async () => {
    sendRequest.mockImplementation(async (_method, params) => {
      const id = (params as { envelope: { clientOperationId: string } }).envelope.clientOperationId
      if (sendRequest.mock.calls.length === 1) {
        const response = accepted(id)
        return {
          ...response,
          result: {
            ...(response.result as object),
            value: {
              ...(response.result as { value: object }).value,
              submission: {
                ...(response.result as { value: { submission: object } }).value.submission,
                dispatchState: 'unknown'
              }
            }
          }
        }
      }
      return accepted(id)
    })

    await act(async () => {
      await api!.send('possibly delivered')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(api!.outbox[0]?.state).toBe('unconfirmed')
    const firstId = api!.outbox[0]!.clientMessageId
    submissions = [
      {
        clientMessageId: firstId,
        fence: 3,
        payloadFingerprint: 'a'.repeat(64),
        dispatchState: 'unknown',
        providerItemId: null,
        reason: 'reply lost',
        submittedAt: 11,
        resolvedAt: 12
      }
    ]

    await act(async () => {
      renderer!.update(createElement(Probe))
      await api!.send('later')
      await Promise.resolve()
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)

    await act(async () => {
      await api!.retry(firstId)
      await Promise.resolve()
      await Promise.resolve()
    })

    const retryId = (sendRequest.mock.calls[1]![1] as { envelope: { clientOperationId: string } })
      .envelope.clientOperationId
    expect(retryId).toBe(firstId)
    expect(sendRequest.mock.calls[1]![1]).toMatchObject({ retryUnknown: true })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(sendRequest).toHaveBeenCalledTimes(3)
  })

  it('unblocks a refused queued head when the runtime fence advances', async () => {
    sendRequest
      .mockResolvedValueOnce({
        ...accepted('refused'),
        result: {
          ok: false,
          refusal: { code: 'agent_session_fence_stale', message: 'stale fence', retryable: true }
        }
      })
      .mockImplementationOnce(async (_method, params) => {
        const id = (params as { envelope: { clientOperationId: string } }).envelope
          .clientOperationId
        return accepted(id)
      })

    await act(async () => {
      await api!.send('retry after reconnect')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(api!.outbox[0]?.state).toBe('queued')

    fence = 4
    await act(async () => {
      renderer!.update(createElement(Probe))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(
      (sendRequest.mock.calls[1]![1] as { envelope: { expectedRuntimeFence: number } }).envelope
        .expectedRuntimeFence
    ).toBe(4)
  })

  it('requeues an in-flight stale-fence response under the replacement fence', async () => {
    const oldResponse = deferred<RpcSuccess>()
    sendRequest
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(async (_method, params) => {
        const id = (params as { envelope: { clientOperationId: string } }).envelope
          .clientOperationId
        return accepted(id)
      })

    await act(async () => {
      await api!.send('survive reattach')
      await Promise.resolve()
    })
    fence = 4
    await act(async () => {
      renderer!.update(createElement(Probe))
      oldResponse.resolve({
        ...accepted('stale'),
        result: {
          ok: false,
          refusal: { code: 'agent_session_fence_stale', message: 'stale fence', retryable: true }
        }
      })
      await oldResponse.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(
      (sendRequest.mock.calls[1]![1] as { envelope: { expectedRuntimeFence: number } }).envelope
        .expectedRuntimeFence
    ).toBe(4)
  })

  it('retries an unresolved dispatch after a same-fence reconnect', async () => {
    const oldResponse = deferred<RpcSuccess>()
    sendRequest
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(async (_method, params) => {
        const id = (params as { envelope: { clientOperationId: string } }).envelope
          .clientOperationId
        return accepted(id)
      })

    await act(async () => {
      await api!.send('survive reconnect')
      await Promise.resolve()
    })
    connected = false
    act(() => renderer!.update(createElement(Probe)))
    connected = true
    await act(async () => {
      renderer!.update(createElement(Probe))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(api!.outbox).toEqual([])

    await act(async () => {
      oldResponse.resolve(accepted('stale'))
      await oldResponse.promise
    })
    expect(api!.outbox).toEqual([])
  })

  it('answers a durable approval with its expected revision compare-and-set', async () => {
    sendRequest.mockResolvedValue({
      ...accepted('approval'),
      result: {
        ok: true,
        replayed: false,
        fence: 3,
        cursor: { epoch: 'epoch-1', sequence: 4 },
        value: {
          itemId: 'orca:approval-1',
          revision: 8,
          resolution: {
            state: 'resolved',
            selectedOptionId: 'accept',
            resolvedBy: 'mobile',
            resolvedAt: 2
          }
        }
      }
    })

    await act(async () => {
      await api!.respondToPrompt(
        {
          itemId: 'orca:approval-1',
          revision: 7,
          sequence: 3,
          observedAt: 1,
          body: {
            kind: 'approval',
            title: 'Run command?',
            detail: 'pnpm test',
            options: [{ id: 'accept', label: 'Allow' }],
            resolution: {
              state: 'pending',
              selectedOptionId: null,
              resolvedBy: null,
              resolvedAt: null
            }
          }
        },
        'accept'
      )
    })

    expect(sendRequest).toHaveBeenCalledWith(
      'agentSession.respondToApproval',
      expect.objectContaining({
        itemId: 'orca:approval-1',
        expectedRevision: 7,
        optionId: 'accept',
        envelope: expect.objectContaining({ expectedRuntimeFence: 3 })
      })
    )
  })

  it('turns an RPC failure response into a handled mutation error', async () => {
    sendRequest.mockResolvedValue({
      id: 'set-option',
      ok: false,
      _meta: { runtimeId: 'runtime-1' },
      error: { code: 'forbidden', message: 'not allowed' }
    })

    let applied!: boolean
    await act(async () => {
      applied = await api!.setOption('model', 'gpt-5.6-sol')
    })

    expect(applied).toBe(false)
    expect(api!.error).toBe('not allowed')
  })

  it('isolates mutation ids and late errors across session changes', async () => {
    const first = deferred<RpcSuccess>()
    sendRequest.mockImplementationOnce(() => first.promise).mockResolvedValueOnce(accepted('b'))

    let mutationA!: Promise<boolean>
    act(() => {
      mutationA = api!.setOption('model', 'gpt-5.6-sol')
    })
    const operationA = (
      sendRequest.mock.calls[0]![1] as { envelope: { clientOperationId: string } }
    ).envelope.clientOperationId

    sessionId = 'mobile_2'
    await act(async () => {
      renderer!.update(createElement(Probe))
      await Promise.resolve()
    })
    await act(async () => {
      await api!.setOption('model', 'gpt-5.6-sol')
    })
    const operationB = (
      sendRequest.mock.calls[1]![1] as { envelope: { clientOperationId: string } }
    ).envelope.clientOperationId
    expect(operationB).not.toBe(operationA)

    await act(async () => {
      first.resolve({
        id: 'a',
        ok: false,
        _meta: { runtimeId: 'runtime-1' },
        error: { code: 'failed', message: 'late session A failure' }
      })
      await mutationA
    })
    expect(api!.error).toBeNull()
  })
})
