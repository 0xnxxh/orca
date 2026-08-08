import { describe, expect, it, vi } from 'vitest'
import type { PtyIncarnationId } from '../../shared/pty-incarnation'
import { SshPtyHeldProducerPause } from './ssh-pty-held-producer-pause'

const incarnationId = '11111111-1111-4111-8111-111111111111' as PtyIncarnationId

describe('SshPtyHeldProducerPause', () => {
  it('requires current incarnation capability and awaits the request acknowledgement', async () => {
    let current = true
    let settle!: (value: unknown) => void
    const mux = {
      request: vi.fn(() => new Promise((resolve) => (settle = resolve))),
      isDisposed: vi.fn(() => false)
    }
    const pause = new SshPtyHeldProducerPause({
      mux: mux as never,
      capability: {
        version: 1,
        clientGeneration: 3,
        ownerGeneration: 4,
        isCurrentProviderGeneration: () => current
      },
      toRelayPtyId: (id) => id,
      getPtyIncarnation: () => incarnationId
    })

    const acquiring = pause.acquire('pty-1', incarnationId, 'held-1')
    let completed = false
    void acquiring.then(() => (completed = true))
    await Promise.resolve()
    expect(completed).toBe(false)
    settle({ applied: true })
    await expect(acquiring).resolves.toBe(true)
    expect(mux.request).toHaveBeenCalledWith(
      'pty.setDeliveryPaused',
      expect.objectContaining({ paused: true, heldPauseToken: 'held-1' }),
      { timeoutMs: 10_000 }
    )

    current = false
    expect(pause.supports('pty-1', incarnationId)).toBe(false)
  })

  it('issues a compensating release when the provider is superseded before acknowledgement', async () => {
    let current = true
    const mux = {
      request: vi.fn(async (_method: string, params: { paused: boolean }) => {
        if (params.paused) {
          current = false
        }
        return { applied: true }
      }),
      isDisposed: vi.fn(() => false)
    }
    const pause = new SshPtyHeldProducerPause({
      mux: mux as never,
      capability: {
        version: 1,
        clientGeneration: 3,
        ownerGeneration: 4,
        isCurrentProviderGeneration: () => current
      },
      toRelayPtyId: (id) => id,
      getPtyIncarnation: () => incarnationId
    })

    await expect(pause.acquire('pty-1', incarnationId, 'held-1')).resolves.toBe(false)
    expect(mux.request.mock.calls.map(([, params]) => params.paused)).toEqual([true, false])
  })
})
