import { describe, expect, it, vi } from 'vitest'
import type { PtyIncarnationId } from '../../shared/pty-incarnation'
import { PtyRendererBindingHeldPauseController } from './pty-renderer-binding-held-pause'

const incarnationId = '11111111-1111-4111-8111-111111111111' as PtyIncarnationId

function provider() {
  return {
    supportsExactHeldProducerPause: vi.fn(() => true),
    acquireExactHeldProducerPause: vi.fn(async () => true),
    releaseExactHeldProducerPause: vi.fn(async () => true)
  }
}

describe('PtyRendererBindingHeldPauseController', () => {
  it('uses monotonic provider-scoped tokens and releases committed leases', async () => {
    const capable = provider()
    const controller = new PtyRendererBindingHeldPauseController({ onReleaseFailure: vi.fn() })
    const first = await controller.acquire(capable as never, 'pty-1', incarnationId)
    const second = await controller.acquire(capable as never, 'pty-2', incarnationId)

    expect(first?.token).toBe('renderer-binding-1')
    expect(second?.token).toBe('renderer-binding-2')
    controller.commit(first!)
    await expect(controller.release('pty-1')).resolves.toBe(true)
    expect(capable.releaseExactHeldProducerPause).toHaveBeenCalledWith(
      'pty-1',
      incarnationId,
      'renderer-binding-1'
    )
  })

  it('keeps a failed predecessor lease for the final retry', async () => {
    const capable = provider()
    capable.releaseExactHeldProducerPause.mockResolvedValueOnce(false).mockResolvedValue(true)
    const onReleaseFailure = vi.fn()
    const controller = new PtyRendererBindingHeldPauseController({ onReleaseFailure })
    const first = (await controller.acquire(capable as never, 'pty-1', incarnationId))!
    const second = (await controller.acquire(capable as never, 'pty-1', incarnationId))!
    controller.commit(first)
    controller.commit(second)
    await vi.waitFor(() => expect(onReleaseFailure).toHaveBeenCalledOnce())

    await expect(controller.release('pty-1')).resolves.toBe(true)
    expect(capable.releaseExactHeldProducerPause).toHaveBeenCalledTimes(3)
  })
})
