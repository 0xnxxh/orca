import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  enqueueMobileDictationAudioChunk,
  MOBILE_DICTATION_MAX_PENDING_CHUNKS
} from './mobile-dictation-audio-chunk'
import { MobileDictationPendingAudioBudget } from './mobile-dictation-pending-audio-budget'

describe('enqueueMobileDictationAudioChunk', () => {
  it('forwards the native capture rate and falls back for older native events', async () => {
    const sendRequest = vi.fn(async () => ({
      id: 'rpc',
      ok: true as const,
      result: {},
      _meta: { runtimeId: 'runtime' }
    }))
    const queue = {
      pendingChunks: new Set<Promise<void>>(),
      pendingAudioBudget: new MobileDictationPendingAudioBudget(),
      shouldReleaseBudget: () => true,
      failActiveDictation: vi.fn()
    }
    const client = { sendRequest } as unknown as RpcClient

    enqueueMobileDictationAudioChunk(
      client,
      'native-rate',
      { data: new Uint8Array([1, 2]), sampleRate: 48_000 },
      queue
    )
    enqueueMobileDictationAudioChunk(
      client,
      'fallback-rate',
      { data: new Uint8Array([3, 4]) },
      queue
    )
    await Promise.all(queue.pendingChunks)

    expect(sendRequest).toHaveBeenNthCalledWith(
      1,
      'speech.dictation.chunk',
      expect.objectContaining({ dictationId: 'native-rate', sampleRate: 48_000 })
    )
    expect(sendRequest).toHaveBeenNthCalledWith(
      2,
      'speech.dictation.chunk',
      expect.objectContaining({ dictationId: 'fallback-rate', sampleRate: 16_000 })
    )
  })

  it('accepts the exact pending-promise cap and rejects one over even for empty chunks', () => {
    const sendRequest = vi.fn(() => new Promise<never>(() => undefined))
    const failActiveDictation = vi.fn()
    const pendingChunks = new Set<Promise<void>>()
    const queue = {
      pendingChunks,
      pendingAudioBudget: new MobileDictationPendingAudioBudget(),
      shouldReleaseBudget: () => true,
      failActiveDictation
    }
    const event = { data: new Uint8Array() }

    for (let index = 0; index < MOBILE_DICTATION_MAX_PENDING_CHUNKS; index += 1) {
      enqueueMobileDictationAudioChunk(
        { sendRequest } as unknown as RpcClient,
        'dictation',
        event,
        queue
      )
    }
    expect(pendingChunks).toHaveLength(MOBILE_DICTATION_MAX_PENDING_CHUNKS)
    expect(failActiveDictation).not.toHaveBeenCalled()

    enqueueMobileDictationAudioChunk(
      { sendRequest } as unknown as RpcClient,
      'dictation',
      event,
      queue
    )
    expect(pendingChunks).toHaveLength(MOBILE_DICTATION_MAX_PENDING_CHUNKS)
    expect(failActiveDictation).toHaveBeenCalledOnce()
  })
})
