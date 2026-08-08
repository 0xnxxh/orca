import { describe, expect, it, vi } from 'vitest'
import type { PtyIncarnationId } from '../../shared/pty-incarnation'
import type { ExactPtyMutationAccess } from '../../shared/pty-renderer-binding'
import type { TerminalSideEffectBatch } from '../../shared/terminal-side-effect-facts'
import { PtyRendererBindingFenceRegistry } from './pty-renderer-binding-fence'
import {
  PtyRendererSideEffectDelivery,
  type PtyRendererSideEffectBinding
} from './pty-renderer-side-effect-delivery'

const currentIncarnation = '11111111-1111-4111-8111-111111111111' as PtyIncarnationId

function access(): ExactPtyMutationAccess {
  return {
    mode: 'exact',
    identity: {
      incarnationId: currentIncarnation,
      paneGeneration: 7,
      mutationLeaseId: 'lease-current'
    },
    claimant: { rendererEpochId: 'renderer-1', sequence: 3 }
  }
}

function batch(seq: number, incarnationId?: string): TerminalSideEffectBatch {
  return {
    ptyId: 'pty-1',
    ...(incarnationId ? { ptyIncarnationId: incarnationId as PtyIncarnationId } : {}),
    seq,
    facts: [{ kind: 'bell' }]
  }
}

function setup(
  fences = new PtyRendererBindingFenceRegistry(),
  initialBinding: PtyRendererSideEffectBinding = {
    mode: 'exact',
    incarnationId: currentIncarnation
  }
) {
  let binding = initialBinding
  const published: TerminalSideEffectBatch[] = []
  const onPressureChanged = vi.fn()
  const onReleased = vi.fn()
  const onReplayDeferred = vi.fn()
  const onUnresolved = vi.fn()
  let publishOverride: ((candidate: TerminalSideEffectBatch) => void) | null = null
  const delivery = new PtyRendererSideEffectDelivery({
    fences,
    resolveBinding: () => binding,
    publish: (candidate) => {
      if (publishOverride) {
        publishOverride(candidate)
        return
      }
      published.push(candidate)
    },
    onPressureChanged,
    onReleased,
    onReplayDeferred,
    onUnresolved
  })
  return {
    delivery,
    published,
    onPressureChanged,
    onReleased,
    onReplayDeferred,
    onUnresolved,
    setPublish: (next: (candidate: TerminalSideEffectBatch) => void) => {
      publishOverride = next
    },
    setBinding: (next: PtyRendererSideEffectBinding) => {
      binding = next
    }
  }
}

describe('PtyRendererSideEffectDelivery', () => {
  it('publishes only the current exact incarnation when no handoff is fenced', () => {
    const context = setup()

    context.delivery.publish(batch(1, 'incarnation-old'))
    context.delivery.publish(batch(2))
    context.delivery.publish(batch(3, currentIncarnation))

    expect(context.published).toEqual([batch(3, currentIncarnation)])
    expect(context.onUnresolved).toHaveBeenNthCalledWith(1, 'pty-1', 1)
    expect(context.onUnresolved).toHaveBeenNthCalledWith(2, 'pty-1', 1)
  })

  it('downgrades identity only for an explicitly legacy binding', () => {
    const context = setup(new PtyRendererBindingFenceRegistry(), { mode: 'legacy' })

    context.delivery.publish(batch(1, currentIncarnation))
    context.delivery.publish(batch(2))

    expect(context.published).toEqual([batch(1), batch(2)])
    expect(context.onUnresolved).not.toHaveBeenCalled()
  })

  it('retains pre-commit ordering and releases only the committed exact incarnation', () => {
    const fences = new PtyRendererBindingFenceRegistry()
    const context = setup(fences)
    const exact = access()
    const token = fences.begin({
      id: 'pty-1',
      paneGeneration: 7,
      claimant: exact.claimant
    })!

    context.delivery.publish(batch(1, 'incarnation-old'))
    context.delivery.publish(batch(2, currentIncarnation))
    context.delivery.publish(batch(3))
    context.delivery.publish(batch(4, currentIncarnation))
    expect(context.published).toEqual([])

    expect(fences.finalize(token, exact)).toBe(true)
    const retention = fences.settleExactWithSideEffects('pty-1', exact)!
    context.delivery.releaseExact(retention, exact)

    expect(context.published).toEqual([batch(2, currentIncarnation), batch(4, currentIncarnation)])
    expect(context.onUnresolved).toHaveBeenCalledWith('pty-1', 2)
    expect(context.onReleased).toHaveBeenCalledWith('pty-1')
  })

  it('replays still-current predecessor batches after pre-finalize cancellation', () => {
    const fences = new PtyRendererBindingFenceRegistry()
    const context = setup(fences, { mode: 'exact', incarnationId: 'incarnation-old' })
    const token = fences.begin({
      id: 'pty-1',
      paneGeneration: 8,
      claimant: { rendererEpochId: 'renderer-1', sequence: 4 },
      incarnationId: 'incarnation-old'
    })!
    context.delivery.publish(batch(1, 'incarnation-old'))
    context.delivery.publish(batch(2, currentIncarnation))

    const retention = fences.cancelTokenWithSideEffects(token)!
    context.delivery.releaseCurrent(retention)

    expect(context.published).toEqual([batch(1, 'incarnation-old')])
    expect(context.onUnresolved).toHaveBeenCalledWith('pty-1', 1)
  })

  it('classifies bounded overflow instead of silently dropping it', () => {
    const fences = new PtyRendererBindingFenceRegistry({
      maxSideEffectBatches: 1,
      maxSideEffectChars: 10_000,
      sideEffectBackpressureBatches: 1,
      sideEffectBackpressureChars: 10_000
    })
    const context = setup(fences)
    const token = fences.begin({
      id: 'pty-1',
      paneGeneration: 7,
      claimant: { rendererEpochId: 'renderer-1', sequence: 3 }
    })!
    context.delivery.publish(batch(1, currentIncarnation))
    context.delivery.publish(batch(2, currentIncarnation))

    const release = fences.cancelTokenWithSideEffects(token)!
    context.delivery.abandonRelease(release)

    expect(context.published).toEqual([])
    expect(context.onPressureChanged).toHaveBeenCalledWith('pty-1')
    expect(context.onUnresolved).toHaveBeenCalledWith('pty-1', 2)
  })

  it('drains reentrant batches before notifying the producer release', () => {
    const fences = new PtyRendererBindingFenceRegistry()
    const context = setup(fences)
    const token = fences.begin({
      id: 'pty-1',
      paneGeneration: 7,
      claimant: { rendererEpochId: 'renderer-1', sequence: 3 }
    })!
    context.delivery.publish(batch(1, currentIncarnation))
    context.setPublish((candidate) => {
      context.published.push(candidate)
      if (candidate.seq === 1) {
        context.delivery.publish(batch(2, currentIncarnation))
      }
    })

    context.delivery.releaseCurrent(fences.cancelTokenWithSideEffects(token)!)

    expect(context.published).toEqual([batch(1, currentIncarnation), batch(2, currentIncarnation)])
    expect(context.onReleased).toHaveBeenCalledOnce()
  })

  it('retries a failed send without duplicating the committed prefix', () => {
    const fences = new PtyRendererBindingFenceRegistry()
    const context = setup(fences)
    const token = fences.begin({
      id: 'pty-1',
      paneGeneration: 7,
      claimant: { rendererEpochId: 'renderer-1', sequence: 3 }
    })!
    context.delivery.publish(batch(1, currentIncarnation))
    context.delivery.publish(batch(2, currentIncarnation))
    let failSecond = true
    context.setPublish((candidate) => {
      if (candidate.seq === 2 && failSecond) {
        failSecond = false
        throw new Error('renderer unavailable')
      }
      context.published.push(candidate)
    })

    expect(context.delivery.releaseCurrent(fences.cancelTokenWithSideEffects(token)!)).toBe(false)
    expect(context.published).toEqual([batch(1, currentIncarnation)])
    expect(context.onReleased).not.toHaveBeenCalled()
    expect(context.delivery.retry('pty-1')).toBe(true)
    expect(context.published).toEqual([batch(1, currentIncarnation), batch(2, currentIncarnation)])
    expect(context.onReplayDeferred).toHaveBeenCalledOnce()
    expect(context.onReleased).toHaveBeenCalledOnce()
  })
})
