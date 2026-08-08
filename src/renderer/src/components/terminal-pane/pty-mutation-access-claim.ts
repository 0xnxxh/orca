import type {
  PtyMutationAccess,
  PtyMutationClaimant
} from '../../../../shared/pty-mutation-identity'
import { parsePtyMutationAccess } from '../../../../shared/pty-mutation-identity'

type ClaimCallbacks = {
  onClaimed: (access: PtyMutationAccess) => void
  onUnavailable: (error: Error) => void
}

export function normalizePtyMutationAccess(
  value: unknown,
  paneGeneration: number | undefined,
  expectedClaimant?: PtyMutationClaimant
): PtyMutationAccess {
  const parsed = parsePtyMutationAccess(value)
  if (
    parsed?.mode === 'exact' &&
    ((paneGeneration !== undefined && parsed.identity.paneGeneration !== paneGeneration) ||
      (expectedClaimant !== undefined &&
        (parsed.claimant.rendererEpochId !== expectedClaimant.rendererEpochId ||
          parsed.claimant.sequence !== expectedClaimant.sequence)))
  ) {
    return { mode: 'unavailable' }
  }
  return parsed ?? { mode: 'unavailable' }
}

export function createPtyMutationAccessClaim(options: {
  tabId?: string
  leafId?: string
  paneGeneration?: number
}): {
  start: (id: string, claimant: PtyMutationClaimant, callbacks: ClaimCallbacks) => void
  cancel: () => void
} {
  let epoch = 0

  const canClaim = (): boolean =>
    Boolean(options.tabId && options.leafId && options.paneGeneration !== undefined)

  function cancel(): void {
    epoch += 1
  }

  return {
    start(id, claimant, callbacks): void {
      cancel()
      const claimEpoch = epoch
      if (!canClaim()) {
        callbacks.onUnavailable(new Error('pty_mutation_access_claim_identity_missing'))
        return
      }
      try {
        void window.api.pty
          .claimMutationAccess({
            id,
            tabId: options.tabId!,
            leafId: options.leafId!,
            paneGeneration: options.paneGeneration!,
            claimant
          })
          .then(
            (value) => {
              if (claimEpoch !== epoch) {
                return
              }
              const access = normalizePtyMutationAccess(value, options.paneGeneration, claimant)
              if (access.mode === 'unavailable') {
                callbacks.onUnavailable(new Error('pty_mutation_access_unavailable'))
                return
              }
              callbacks.onClaimed(access)
            },
            () => {
              if (claimEpoch === epoch) {
                callbacks.onUnavailable(new Error('pty_mutation_access_unavailable'))
              }
            }
          )
      } catch {
        if (claimEpoch === epoch) {
          callbacks.onUnavailable(new Error('pty_mutation_access_unavailable'))
        }
      }
    },
    cancel
  }
}
