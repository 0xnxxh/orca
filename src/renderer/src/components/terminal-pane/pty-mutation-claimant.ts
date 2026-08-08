import type { PtyMutationClaimant } from '../../../../shared/pty-mutation-identity'

const rendererEpochId = globalThis.crypto.randomUUID()
let nextSequence = 0

export function mintPtyMutationClaimant(): PtyMutationClaimant {
  nextSequence += 1
  return { rendererEpochId, sequence: nextSequence }
}
