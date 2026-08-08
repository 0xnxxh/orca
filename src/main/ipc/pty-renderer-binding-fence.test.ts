import { describe, expect, it } from 'vitest'
import type { PtyIncarnationId } from '../../shared/pty-incarnation'
import type { ExactPtyMutationAccess } from '../../shared/pty-renderer-binding'
import type { TerminalSideEffectBatch } from '../../shared/terminal-side-effect-facts'
import { PtyRendererBindingFenceRegistry } from './pty-renderer-binding-fence'

const incarnationId = '11111111-1111-4111-8111-111111111111' as PtyIncarnationId

function access(
  paneGeneration: number,
  sequence: number,
  mutationLeaseId: string
): ExactPtyMutationAccess {
  return {
    mode: 'exact',
    identity: { incarnationId, paneGeneration, mutationLeaseId },
    claimant: { rendererEpochId: 'renderer-1', sequence }
  }
}

function batch(seq: number, ptyIncarnationId?: string): TerminalSideEffectBatch {
  return {
    ptyId: 'pty-1',
    ...(ptyIncarnationId ? { ptyIncarnationId: ptyIncarnationId as PtyIncarnationId } : {}),
    seq,
    facts: [{ kind: 'bell' }]
  }
}

describe('PtyRendererBindingFenceRegistry', () => {
  it('lets a newer same-generation claimant supersede an overlapping reconnect', () => {
    const registry = new PtyRendererBindingFenceRegistry()
    const stale = registry.begin({
      id: 'pty-1',
      paneGeneration: 8,
      claimant: { rendererEpochId: 'renderer-1', sequence: 1 }
    })!
    const current = registry.begin({
      id: 'pty-1',
      paneGeneration: 8,
      claimant: { rendererEpochId: 'renderer-1', sequence: 2 }
    })!

    expect(registry.owns(stale)).toBe(false)
    expect(registry.owns(current)).toBe(true)
    expect(registry.finalize(stale, access(8, 1, 'lease-1'))).toBe(false)
    expect(registry.finalize(current, access(8, 2, 'lease-2'))).toBe(true)
    expect(registry.settleExactWithSideEffects('pty-1', access(8, 1, 'lease-1'))).toBeNull()
    expect(
      registry.cancelClaimWithSideEffects({
        id: 'pty-1',
        paneGeneration: 8,
        claimant: { rendererEpochId: 'renderer-1', sequence: 2 }
      })
    ).toBeNull()
    const release = registry.settleExactWithSideEffects('pty-1', access(8, 2, 'lease-2'))!
    expect(release).toEqual({ id: 'pty-1', ordinal: 2 })
    expect(registry.isBlocked('pty-1')).toBe(true)
    expect(registry.drainSideEffectRelease(release, () => true)).toEqual({
      id: 'pty-1',
      unresolvedBatchCount: 0
    })
    expect(registry.isBlocked('pty-1')).toBe(false)
    expect(
      registry.begin({
        id: 'pty-1',
        paneGeneration: 8,
        claimant: { rendererEpochId: 'renderer-1', sequence: 1 }
      })
    ).toBeNull()
  })

  it('keeps a newer pane generation fenced against later stale begin and cancel messages', () => {
    const registry = new PtyRendererBindingFenceRegistry()
    const current = registry.begin({
      id: 'pty-1',
      paneGeneration: 9,
      claimant: { rendererEpochId: 'renderer-1', sequence: 3 }
    })!

    expect(
      registry.begin({
        id: 'pty-1',
        paneGeneration: 8,
        claimant: { rendererEpochId: 'renderer-1', sequence: 99 }
      })
    ).toBeNull()
    expect(
      registry.cancelClaimWithSideEffects({
        id: 'pty-1',
        paneGeneration: 8,
        claimant: { rendererEpochId: 'renderer-1', sequence: 99 }
      })
    ).toBeNull()
    expect(registry.owns(current)).toBe(true)
    expect(registry.isBlocked('pty-1')).toBe(true)
  })

  it('requires the full incarnation, pane generation, lease, and claimant to settle', () => {
    const registry = new PtyRendererBindingFenceRegistry()
    const token = registry.begin({
      id: 'pty-1',
      paneGeneration: 4,
      claimant: { rendererEpochId: 'renderer-1', sequence: 7 }
    })!
    const exact = access(4, 7, 'lease-current')

    expect(registry.finalize(token, exact)).toBe(true)
    expect(registry.settleExactWithSideEffects('pty-1', access(4, 7, 'lease-stale'))).toBeNull()
    expect(
      registry.settleExactWithSideEffects('pty-1', {
        ...exact,
        identity: {
          ...exact.identity,
          incarnationId: '22222222-2222-4222-8222-222222222222' as PtyIncarnationId
        }
      })
    ).toBeNull()
    expect(registry.isBlocked('pty-1')).toBe(true)
  })

  it('carries ordered batches into a superseding claim until exact settlement', () => {
    const registry = new PtyRendererBindingFenceRegistry()
    const stale = registry.begin({
      id: 'pty-1',
      paneGeneration: 4,
      claimant: { rendererEpochId: 'renderer-1', sequence: 1 }
    })!
    expect(registry.retainSideEffect(batch(1, 'incarnation-old'))).toBe('retained')
    const current = registry.begin({
      id: 'pty-1',
      paneGeneration: 5,
      claimant: { rendererEpochId: 'renderer-1', sequence: 2 }
    })!
    expect(registry.retainSideEffect(batch(2, incarnationId))).toBe('retained')

    expect(registry.cancelTokenWithSideEffects(stale)).toBeNull()
    expect(registry.finalize(current, access(5, 2, 'lease-current'))).toBe(true)
    const release = registry.settleExactWithSideEffects('pty-1', access(5, 2, 'lease-current'))!
    const drained: TerminalSideEffectBatch[] = []
    expect(
      registry.drainSideEffectRelease(release, (candidate) => {
        drained.push(candidate)
        return true
      })
    ).toEqual({
      id: 'pty-1',
      unresolvedBatchCount: 0
    })
    expect(drained).toEqual([batch(1, 'incarnation-old'), batch(2, incarnationId)])
  })

  it('bounds retention and requests backpressure before classifying overflow', () => {
    const registry = new PtyRendererBindingFenceRegistry({
      maxSideEffectBatches: 2,
      maxSideEffectChars: 10_000,
      sideEffectBackpressureBatches: 1,
      sideEffectBackpressureChars: 10_000
    })
    const token = registry.begin({
      id: 'pty-1',
      paneGeneration: 4,
      claimant: { rendererEpochId: 'renderer-1', sequence: 1 }
    })!

    expect(registry.retainSideEffect(batch(1, incarnationId))).toBe('backpressure')
    expect(registry.needsSideEffectBackpressure('pty-1')).toBe(true)
    expect(registry.retainSideEffect(batch(2, incarnationId))).toBe('backpressure')
    expect(registry.retainSideEffect(batch(3, incarnationId))).toBe('overflow')
    const release = registry.cancelTokenWithSideEffects(token)!
    const drained: TerminalSideEffectBatch[] = []
    expect(
      registry.drainSideEffectRelease(release, (candidate) => {
        drained.push(candidate)
        return true
      })
    ).toEqual({
      id: 'pty-1',
      unresolvedBatchCount: 1
    })
    expect(drained).toEqual([batch(1, incarnationId), batch(2, incarnationId)])
    expect(registry.needsSideEffectBackpressure('pty-1')).toBe(false)
  })

  it('commits only a successfully delivered prefix and retains the failed suffix', () => {
    const registry = new PtyRendererBindingFenceRegistry()
    const token = registry.begin({
      id: 'pty-1',
      paneGeneration: 4,
      claimant: { rendererEpochId: 'renderer-1', sequence: 1 }
    })!
    registry.retainSideEffect(batch(1, incarnationId))
    registry.retainSideEffect(batch(2, incarnationId))
    const release = registry.cancelTokenWithSideEffects(token)!

    expect(() =>
      registry.drainSideEffectRelease(release, (candidate) => {
        if (candidate.seq === 2) {
          throw new Error('renderer unavailable')
        }
        return true
      })
    ).toThrow('renderer unavailable')
    expect(registry.isBlocked('pty-1')).toBe(true)

    const retried: TerminalSideEffectBatch[] = []
    expect(
      registry.drainSideEffectRelease(release, (candidate) => {
        retried.push(candidate)
        return true
      })
    ).toEqual({ id: 'pty-1', unresolvedBatchCount: 0 })
    expect(retried).toEqual([batch(2, incarnationId)])
  })
})
