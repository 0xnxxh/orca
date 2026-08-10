import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
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
  const original = await importOriginal<typeof import('./mobile-structured-outbox-store')>()
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

  function Probe(): null {
    api = useMobileStructuredSessionWrites({
      client,
      sessionId: 'mobile_1',
      fence: 3,
      items: [],
      submissions: []
    })
    return null
  }

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.mocked(loadMobileStructuredOutbox).mockReset().mockResolvedValue([])
    vi.mocked(saveMobileStructuredOutbox).mockReset().mockResolvedValue(undefined)
    sendRequest.mockReset()
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

  it('keeps unknown delivery visible and retries with the same client message id', async () => {
    sendRequest
      .mockResolvedValueOnce({
        ...accepted('unused'),
        result: {
          ...(accepted('unused').result as object),
          value: {
            ...(accepted('unused').result as { value: object }).value,
            submission: {
              ...(accepted('unused').result as { value: { submission: object } }).value.submission,
              dispatchState: 'unknown'
            }
          }
        }
      })
      .mockImplementationOnce(async (_method, params) => {
        const id = (params as { envelope: { clientOperationId: string } }).envelope
          .clientOperationId
        return accepted(id)
      })

    await act(async () => {
      await api!.send('possibly delivered')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(api!.outbox[0]?.state).toBe('unconfirmed')
    const firstId = api!.outbox[0]!.clientMessageId

    await act(async () => {
      await api!.retry(firstId)
      await Promise.resolve()
      await Promise.resolve()
    })

    const retryId = (sendRequest.mock.calls[1]![1] as { envelope: { clientOperationId: string } })
      .envelope.clientOperationId
    expect(retryId).toBe(firstId)
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
})
