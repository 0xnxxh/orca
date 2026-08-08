import type { PtyIncarnationId } from '../../../../shared/pty-incarnation'
import type { PtyMutationIdentity } from '../../../../shared/pty-mutation-identity'

export type ParkedTerminalSideEffectIdentity = {
  incarnationId: PtyIncarnationId
  paneGeneration: number
}

export function parkedTerminalSideEffectIdentityFromMutation(
  identity: PtyMutationIdentity | null | undefined
): ParkedTerminalSideEffectIdentity | null {
  return identity?.paneGeneration === undefined
    ? null
    : {
        incarnationId: identity.incarnationId,
        paneGeneration: identity.paneGeneration
      }
}

export function parkedTerminalSideEffectIdentitiesEqual(
  left: ParkedTerminalSideEffectIdentity | undefined,
  right: ParkedTerminalSideEffectIdentity | undefined
): boolean {
  return (
    left?.incarnationId === right?.incarnationId && left?.paneGeneration === right?.paneGeneration
  )
}
