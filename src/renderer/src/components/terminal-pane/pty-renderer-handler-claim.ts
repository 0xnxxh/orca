import type { PtyMutationClaimant } from '../../../../shared/pty-mutation-identity'
import {
  comparePtyRendererBindingClaims,
  exactPtyMutationAccessesEqual,
  type ExactPtyMutationAccess
} from '../../../../shared/pty-renderer-binding'

export type PtyRendererHandlerClaim = {
  paneGeneration: number
  claimant: PtyMutationClaimant
  access?: ExactPtyMutationAccess
}

const claimsByPty = new Map<string, PtyRendererHandlerClaim>()

export function claimPtyRendererHandlers(id: string, claim?: PtyRendererHandlerClaim): boolean {
  if (!claim) {
    return !claimsByPty.has(id)
  }
  const current = claimsByPty.get(id)
  if (current) {
    const comparison = comparePtyRendererBindingClaims(claim, current)
    if (comparison < 0) {
      return false
    }
    if (
      comparison === 0 &&
      current.access &&
      (!claim.access || !exactPtyMutationAccessesEqual(claim.access, current.access))
    ) {
      return false
    }
  }
  claimsByPty.set(id, claim)
  return true
}

export function releasePtyRendererHandlerClaim(
  id: string,
  claim: PtyRendererHandlerClaim | undefined
): void {
  if (claim && claimsByPty.get(id) === claim) {
    claimsByPty.delete(id)
  }
}
