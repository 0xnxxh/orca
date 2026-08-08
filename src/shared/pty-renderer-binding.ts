import type { PtyMutationAccess, PtyMutationClaimant } from './pty-mutation-identity'

export type ExactPtyMutationAccess = Extract<PtyMutationAccess, { mode: 'exact' }>

export type PtyRendererBindingClaim = {
  id: string
  paneGeneration: number
  claimant: PtyMutationClaimant
}

export type PtyRendererBindingReady = {
  id: string
  access: ExactPtyMutationAccess
}

export type PtyRendererBindingCancel = PtyRendererBindingClaim & {
  access?: ExactPtyMutationAccess
}

export function ptyMutationClaimantsEqual(
  left: PtyMutationClaimant,
  right: PtyMutationClaimant
): boolean {
  return left.rendererEpochId === right.rendererEpochId && left.sequence === right.sequence
}

export function exactPtyMutationAccessesEqual(
  left: ExactPtyMutationAccess,
  right: ExactPtyMutationAccess
): boolean {
  return (
    ptyMutationClaimantsEqual(left.claimant, right.claimant) &&
    left.identity.incarnationId === right.identity.incarnationId &&
    left.identity.paneGeneration === right.identity.paneGeneration &&
    left.identity.mutationLeaseId === right.identity.mutationLeaseId
  )
}

export function comparePtyRendererBindingClaims(
  left: Pick<PtyRendererBindingClaim, 'paneGeneration' | 'claimant'>,
  right: Pick<PtyRendererBindingClaim, 'paneGeneration' | 'claimant'>
): number {
  if (left.paneGeneration !== right.paneGeneration) {
    return left.paneGeneration - right.paneGeneration
  }
  if (left.claimant.rendererEpochId !== right.claimant.rendererEpochId) {
    return 1
  }
  return left.claimant.sequence - right.claimant.sequence
}
