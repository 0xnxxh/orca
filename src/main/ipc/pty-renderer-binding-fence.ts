import type {
  ExactPtyMutationAccess,
  PtyRendererBindingClaim
} from '../../shared/pty-renderer-binding'
import {
  comparePtyRendererBindingClaims,
  exactPtyMutationAccessesEqual,
  ptyMutationClaimantsEqual
} from '../../shared/pty-renderer-binding'
import type { TerminalSideEffectBatch } from '../../shared/terminal-side-effect-facts'

export const PTY_RENDERER_BINDING_SIDE_EFFECT_MAX_BATCHES = 4_096
export const PTY_RENDERER_BINDING_SIDE_EFFECT_MAX_CHARS = 16 * 1024 * 1024
export const PTY_RENDERER_BINDING_SIDE_EFFECT_BACKPRESSURE_BATCHES = 1_024
export const PTY_RENDERER_BINDING_SIDE_EFFECT_BACKPRESSURE_CHARS = 512 * 1024

export type PtyRendererBindingFenceToken = Readonly<
  PtyRendererBindingClaim & {
    incarnationId?: string
    ordinal: number
  }
>

type PtyRendererBindingFence = {
  token: PtyRendererBindingFenceToken
  access?: ExactPtyMutationAccess
  sideEffects: TerminalSideEffectBatch[]
  sideEffectChars: number
  unresolvedSideEffectBatches: number
  releasePrepared: boolean
}

export type PtyRendererBindingSideEffectRelease = Readonly<{
  id: string
  ordinal: number
}>

export type PtyRendererBindingSideEffectDrainResult = Readonly<{
  id: string
  unresolvedBatchCount: number
}>

export type PtyRendererBindingSideEffectRetention = Readonly<{
  id: string
  batches: readonly TerminalSideEffectBatch[]
  unresolvedBatchCount: number
}>

export type PtyRendererBindingSideEffectRetainResult =
  | 'unfenced'
  | 'retained'
  | 'backpressure'
  | 'overflow'

type PtyRendererBindingFenceOptions = {
  maxSideEffectBatches?: number
  maxSideEffectChars?: number
  sideEffectBackpressureBatches?: number
  sideEffectBackpressureChars?: number
}

function serializedBatchChars(batch: TerminalSideEffectBatch): number {
  try {
    return JSON.stringify(batch).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export class PtyRendererBindingFenceRegistry {
  private readonly fences = new Map<string, PtyRendererBindingFence>()
  private readonly latestClaims = new Map<string, PtyRendererBindingClaim>()
  private readonly maxSideEffectBatches: number
  private readonly maxSideEffectChars: number
  private readonly sideEffectBackpressureBatches: number
  private readonly sideEffectBackpressureChars: number
  private nextOrdinal = 0

  constructor(options: PtyRendererBindingFenceOptions = {}) {
    this.maxSideEffectBatches =
      options.maxSideEffectBatches ?? PTY_RENDERER_BINDING_SIDE_EFFECT_MAX_BATCHES
    this.maxSideEffectChars =
      options.maxSideEffectChars ?? PTY_RENDERER_BINDING_SIDE_EFFECT_MAX_CHARS
    this.sideEffectBackpressureBatches =
      options.sideEffectBackpressureBatches ?? PTY_RENDERER_BINDING_SIDE_EFFECT_BACKPRESSURE_BATCHES
    this.sideEffectBackpressureChars =
      options.sideEffectBackpressureChars ?? PTY_RENDERER_BINDING_SIDE_EFFECT_BACKPRESSURE_CHARS
  }

  begin(
    claim: PtyRendererBindingClaim & { incarnationId?: string }
  ): PtyRendererBindingFenceToken | null {
    const current = this.fences.get(claim.id)
    const latest = current?.token ?? this.latestClaims.get(claim.id)
    if (latest) {
      const comparison = comparePtyRendererBindingClaims(claim, latest)
      if (comparison < 0) {
        return null
      }
      if (comparison === 0 && current) {
        return current.token
      }
    }
    this.nextOrdinal += 1
    const token = Object.freeze({ ...claim, ordinal: this.nextOrdinal })
    this.fences.set(claim.id, {
      token,
      sideEffects: current?.sideEffects ?? [],
      sideEffectChars: current?.sideEffectChars ?? 0,
      unresolvedSideEffectBatches: current?.unresolvedSideEffectBatches ?? 0,
      releasePrepared: false
    })
    this.latestClaims.set(claim.id, token)
    return token
  }

  owns(token: PtyRendererBindingFenceToken): boolean {
    return this.fences.get(token.id)?.token === token
  }

  finalize(token: PtyRendererBindingFenceToken, access: ExactPtyMutationAccess): boolean {
    const current = this.fences.get(token.id)
    if (
      current?.token !== token ||
      access.identity.paneGeneration !== token.paneGeneration ||
      !ptyMutationClaimantsEqual(access.claimant, token.claimant)
    ) {
      return false
    }
    current.access = access
    return true
  }

  retainSideEffect(batch: TerminalSideEffectBatch): PtyRendererBindingSideEffectRetainResult {
    const current = this.fences.get(batch.ptyId)
    if (!current) {
      return 'unfenced'
    }
    const batchChars = serializedBatchChars(batch)
    if (
      current.sideEffects.length >= this.maxSideEffectBatches ||
      batchChars > this.maxSideEffectChars - current.sideEffectChars
    ) {
      current.unresolvedSideEffectBatches += 1
      return 'overflow'
    }
    current.sideEffects.push(batch)
    current.sideEffectChars += batchChars
    return this.needsSideEffectBackpressure(batch.ptyId) ? 'backpressure' : 'retained'
  }

  needsSideEffectBackpressure(id: string): boolean {
    const current = this.fences.get(id)
    return Boolean(
      current &&
      (current.releasePrepared ||
        current.sideEffects.length >= this.sideEffectBackpressureBatches ||
        current.sideEffectChars >= this.sideEffectBackpressureChars ||
        current.unresolvedSideEffectBatches > 0)
    )
  }

  settleExactWithSideEffects(
    id: string,
    access: ExactPtyMutationAccess
  ): PtyRendererBindingSideEffectRelease | null {
    const current = this.fences.get(id)
    if (!current?.access || !exactPtyMutationAccessesEqual(current.access, access)) {
      return null
    }
    return this.prepareRelease(current)
  }

  cancelExactWithSideEffects(
    id: string,
    access: ExactPtyMutationAccess
  ): PtyRendererBindingSideEffectRelease | null {
    const current = this.fences.get(id)
    if (!current?.access || !exactPtyMutationAccessesEqual(current.access, access)) {
      return null
    }
    return this.prepareRelease(current)
  }

  cancelClaimWithSideEffects(
    claim: PtyRendererBindingClaim
  ): PtyRendererBindingSideEffectRelease | null {
    const current = this.fences.get(claim.id)
    if (
      current?.access ||
      !current ||
      current.token.paneGeneration !== claim.paneGeneration ||
      !ptyMutationClaimantsEqual(current.token.claimant, claim.claimant)
    ) {
      return null
    }
    return this.prepareRelease(current)
  }

  cancelTokenWithSideEffects(
    token: PtyRendererBindingFenceToken
  ): PtyRendererBindingSideEffectRelease | null {
    const current = this.fences.get(token.id)
    if (current?.token !== token) {
      return null
    }
    return this.prepareRelease(current)
  }

  drainSideEffectRelease(
    release: PtyRendererBindingSideEffectRelease,
    visit: (batch: TerminalSideEffectBatch) => boolean
  ): PtyRendererBindingSideEffectDrainResult | null {
    const current = this.fences.get(release.id)
    if (
      !current?.releasePrepared ||
      current.token.ordinal !== release.ordinal ||
      current.token.id !== release.id
    ) {
      return null
    }
    let processed = 0
    try {
      while (processed < current.sideEffects.length) {
        if (!visit(current.sideEffects[processed])) {
          current.unresolvedSideEffectBatches += 1
        }
        processed += 1
      }
    } catch (error) {
      this.removeProcessedSideEffects(current, processed)
      throw error
    }
    this.fences.delete(release.id)
    return {
      id: release.id,
      unresolvedBatchCount: current.unresolvedSideEffectBatches
    }
  }

  abandonSideEffectRelease(
    release: PtyRendererBindingSideEffectRelease
  ): PtyRendererBindingSideEffectRetention | null {
    const current = this.fences.get(release.id)
    if (
      !current?.releasePrepared ||
      current.token.ordinal !== release.ordinal ||
      current.token.id !== release.id
    ) {
      return null
    }
    this.fences.delete(release.id)
    return this.takeSideEffects(current)
  }

  isBlocked(id: string): boolean {
    return this.fences.has(id)
  }

  clear(id: string): PtyRendererBindingSideEffectRetention | null {
    this.latestClaims.delete(id)
    const current = this.fences.get(id)
    if (!current) {
      return null
    }
    this.fences.delete(id)
    return this.takeSideEffects(current)
  }

  clearAll(): PtyRendererBindingSideEffectRetention[] {
    const retained = Array.from(this.fences.values(), (fence) => this.takeSideEffects(fence))
    this.fences.clear()
    this.latestClaims.clear()
    return retained
  }

  private takeSideEffects(fence: PtyRendererBindingFence): PtyRendererBindingSideEffectRetention {
    return {
      id: fence.token.id,
      batches: fence.sideEffects,
      unresolvedBatchCount: fence.unresolvedSideEffectBatches
    }
  }

  private prepareRelease(fence: PtyRendererBindingFence): PtyRendererBindingSideEffectRelease {
    fence.releasePrepared = true
    return { id: fence.token.id, ordinal: fence.token.ordinal }
  }

  private removeProcessedSideEffects(fence: PtyRendererBindingFence, count: number): void {
    if (count === 0) {
      return
    }
    const processed = fence.sideEffects.splice(0, count)
    for (const batch of processed) {
      fence.sideEffectChars = Math.max(0, fence.sideEffectChars - serializedBatchChars(batch))
    }
  }
}
