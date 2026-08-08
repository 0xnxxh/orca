import type { PtyIncarnationId } from '../../shared/pty-incarnation'
import type { IPtyProvider } from '../providers/types'

const MAX_RENDERER_BINDING_HELD_PAUSES = 4_096

type ExactHeldPauseProvider = IPtyProvider & {
  supportsExactHeldProducerPause: (id: string, incarnationId: PtyIncarnationId) => boolean
  acquireExactHeldProducerPause: (
    id: string,
    incarnationId: PtyIncarnationId,
    token: string
  ) => Promise<boolean>
  releaseExactHeldProducerPause: (
    id: string,
    incarnationId: PtyIncarnationId,
    token: string
  ) => Promise<boolean>
}

export type PtyRendererBindingHeldPauseLease = Readonly<{
  id: string
  incarnationId: PtyIncarnationId
  token: string
  provider: ExactHeldPauseProvider
}>

type PtyRendererBindingHeldPauseDeps = {
  onReleaseFailure: (lease: PtyRendererBindingHeldPauseLease, error?: unknown) => void
}

function exactHeldPauseProvider(
  provider: IPtyProvider,
  id: string,
  incarnationId: PtyIncarnationId
): ExactHeldPauseProvider | null {
  const candidate = provider as Partial<ExactHeldPauseProvider>
  return typeof candidate.supportsExactHeldProducerPause === 'function' &&
    typeof candidate.acquireExactHeldProducerPause === 'function' &&
    typeof candidate.releaseExactHeldProducerPause === 'function' &&
    candidate.supportsExactHeldProducerPause(id, incarnationId)
    ? (candidate as ExactHeldPauseProvider)
    : null
}

export class PtyRendererBindingHeldPauseController {
  private readonly leasesById = new Map<string, Set<PtyRendererBindingHeldPauseLease>>()
  private readonly nextSerialByProvider = new WeakMap<IPtyProvider, number>()
  private leaseCount = 0

  constructor(private readonly deps: PtyRendererBindingHeldPauseDeps) {}

  supports(provider: IPtyProvider, id: string, incarnationId: PtyIncarnationId): boolean {
    return exactHeldPauseProvider(provider, id, incarnationId) !== null
  }

  has(id: string): boolean {
    return this.leasesById.has(id)
  }

  async acquire(
    provider: IPtyProvider,
    id: string,
    incarnationId: PtyIncarnationId
  ): Promise<PtyRendererBindingHeldPauseLease | null> {
    const capable = exactHeldPauseProvider(provider, id, incarnationId)
    if (!capable || this.leaseCount >= MAX_RENDERER_BINDING_HELD_PAUSES) {
      return null
    }
    const serial = (this.nextSerialByProvider.get(provider) ?? 0) + 1
    this.nextSerialByProvider.set(provider, serial)
    const lease = Object.freeze({
      id,
      incarnationId,
      token: `renderer-binding-${serial}`,
      provider: capable
    })
    return (await capable.acquireExactHeldProducerPause(id, incarnationId, lease.token))
      ? lease
      : null
  }

  commit(lease: PtyRendererBindingHeldPauseLease): void {
    let leases = this.leasesById.get(lease.id)
    if (!leases) {
      leases = new Set()
      this.leasesById.set(lease.id, leases)
    }
    leases.add(lease)
    this.leaseCount += 1
    for (const previous of leases) {
      if (previous !== lease) {
        void this.releaseLease(previous)
      }
    }
  }

  async discard(lease: PtyRendererBindingHeldPauseLease): Promise<boolean> {
    return await this.releaseProviderLease(lease)
  }

  async release(id: string): Promise<boolean> {
    const leases = this.leasesById.get(id)
    if (!leases) {
      return true
    }
    const results = await Promise.all(Array.from(leases, (lease) => this.releaseLease(lease)))
    return results.every(Boolean)
  }

  releaseAll(): void {
    for (const id of this.leasesById.keys()) {
      void this.release(id)
    }
  }

  private async releaseLease(lease: PtyRendererBindingHeldPauseLease): Promise<boolean> {
    const released = await this.releaseProviderLease(lease)
    if (!released) {
      return false
    }
    const leases = this.leasesById.get(lease.id)
    if (leases?.delete(lease)) {
      this.leaseCount -= 1
      if (leases.size === 0) {
        this.leasesById.delete(lease.id)
      }
    }
    return true
  }

  private async releaseProviderLease(lease: PtyRendererBindingHeldPauseLease): Promise<boolean> {
    try {
      const released = await lease.provider.releaseExactHeldProducerPause(
        lease.id,
        lease.incarnationId,
        lease.token
      )
      if (!released) {
        this.deps.onReleaseFailure(lease)
      }
      return released
    } catch (error) {
      this.deps.onReleaseFailure(lease, error)
      return false
    }
  }
}
