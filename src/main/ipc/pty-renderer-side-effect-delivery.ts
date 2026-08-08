import type { ExactPtyMutationAccess } from '../../shared/pty-renderer-binding'
import type { TerminalSideEffectBatch } from '../../shared/terminal-side-effect-facts'
import type {
  PtyRendererBindingFenceRegistry,
  PtyRendererBindingSideEffectRelease,
  PtyRendererBindingSideEffectRetention
} from './pty-renderer-binding-fence'

export type PtyRendererSideEffectBinding =
  | { mode: 'exact'; incarnationId: string }
  | { mode: 'legacy' }
  | { mode: 'unavailable' }

type PtyRendererSideEffectDeliveryDeps = {
  fences: PtyRendererBindingFenceRegistry
  resolveBinding: (id: string) => PtyRendererSideEffectBinding
  publish: (batch: TerminalSideEffectBatch) => void
  onPressureChanged: (id: string) => void
  onReleased: (id: string) => void
  onReplayDeferred: (id: string, error: unknown) => void
  onUnresolved: (id: string, batchCount: number) => void
}

type PendingSideEffectRelease = {
  release: PtyRendererBindingSideEffectRelease
  binding: PtyRendererSideEffectBinding | 'current'
}

function asLegacyBatch(batch: TerminalSideEffectBatch): TerminalSideEffectBatch {
  if (batch.ptyIncarnationId === undefined) {
    return batch
  }
  const { ptyIncarnationId: _unused, ...legacy } = batch
  void _unused
  return legacy
}

export class PtyRendererSideEffectDelivery {
  private readonly pendingReleases = new Map<string, PendingSideEffectRelease>()
  private readonly drainingReleases = new Set<string>()

  constructor(private readonly deps: PtyRendererSideEffectDeliveryDeps) {}

  publish(batch: TerminalSideEffectBatch): void {
    const retained = this.deps.fences.retainSideEffect(batch)
    if (retained !== 'unfenced') {
      this.deps.onPressureChanged(batch.ptyId)
      if (this.pendingReleases.has(batch.ptyId) && !this.drainingReleases.has(batch.ptyId)) {
        this.retry(batch.ptyId)
      }
      return
    }
    try {
      if (!this.publishForBinding(batch, this.deps.resolveBinding(batch.ptyId))) {
        this.reportUnresolved(batch.ptyId, 1)
      }
    } catch (error) {
      this.deps.onReplayDeferred(batch.ptyId, error)
      this.reportUnresolved(batch.ptyId, 1)
    }
  }

  releaseExact(
    release: PtyRendererBindingSideEffectRelease,
    access: ExactPtyMutationAccess
  ): boolean {
    return this.prepareRelease(release, {
      mode: 'exact',
      incarnationId: access.identity.incarnationId
    })
  }

  releaseCurrent(release: PtyRendererBindingSideEffectRelease): boolean {
    return this.prepareRelease(release, 'current')
  }

  retry(id: string): boolean {
    const pending = this.pendingReleases.get(id)
    if (!pending || this.drainingReleases.has(id)) {
      return false
    }
    const binding = pending.binding === 'current' ? this.deps.resolveBinding(id) : pending.binding
    if (binding.mode === 'unavailable') {
      this.deps.onPressureChanged(id)
      return false
    }
    this.drainingReleases.add(id)
    try {
      const drained = this.deps.fences.drainSideEffectRelease(pending.release, (batch) =>
        this.publishForBinding(batch, binding)
      )
      if (!drained) {
        this.pendingReleases.delete(id)
        return false
      }
      this.pendingReleases.delete(id)
      this.reportUnresolved(id, drained.unresolvedBatchCount)
      try {
        this.deps.onReleased(id)
      } finally {
        this.deps.onPressureChanged(id)
      }
      return true
    } catch (error) {
      this.deps.onReplayDeferred(id, error)
      this.deps.onPressureChanged(id)
      return false
    } finally {
      this.drainingReleases.delete(id)
    }
  }

  retryAll(): void {
    for (const id of this.pendingReleases.keys()) {
      this.retry(id)
    }
  }

  abandonRelease(release: PtyRendererBindingSideEffectRelease): void {
    this.pendingReleases.delete(release.id)
    const retention = this.deps.fences.abandonSideEffectRelease(release)
    if (retention) {
      this.classifyUnresolved(retention)
      this.deps.onReleased(release.id)
    }
  }

  reset(retentions: readonly PtyRendererBindingSideEffectRetention[]): void {
    for (const retention of retentions) {
      this.pendingReleases.delete(retention.id)
      this.drainingReleases.delete(retention.id)
      this.deps.onPressureChanged(retention.id)
    }
  }

  classifyUnresolved(retention: PtyRendererBindingSideEffectRetention): void {
    this.pendingReleases.delete(retention.id)
    this.reportUnresolved(retention.id, retention.batches.length + retention.unresolvedBatchCount)
    this.deps.onPressureChanged(retention.id)
  }

  private prepareRelease(
    release: PtyRendererBindingSideEffectRelease,
    binding: PtyRendererSideEffectBinding | 'current'
  ): boolean {
    this.pendingReleases.set(release.id, { release, binding })
    return this.retry(release.id)
  }

  private publishForBinding(
    batch: TerminalSideEffectBatch,
    binding: PtyRendererSideEffectBinding
  ): boolean {
    if (binding.mode === 'legacy') {
      this.deps.publish(asLegacyBatch(batch))
      return true
    }
    if (
      binding.mode === 'exact' &&
      batch.ptyIncarnationId !== undefined &&
      batch.ptyIncarnationId === binding.incarnationId
    ) {
      this.deps.publish(batch)
      return true
    }
    return false
  }

  private reportUnresolved(id: string, batchCount: number): void {
    if (batchCount > 0) {
      this.deps.onUnresolved(id, batchCount)
    }
  }
}
