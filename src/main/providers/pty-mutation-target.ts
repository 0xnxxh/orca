import type {
  PtyAdministrativeMutationEvidence,
  PtyMutationIdentity
} from '../../shared/pty-mutation-identity'
import {
  sameTerminalSessionAuthorityPtyAccess,
  type TerminalSessionAuthorityPtyAccess
} from '../../shared/terminal-session-authority-pty-access'

export type PtyMutationTargetAccess =
  | { mode: 'legacy' }
  | {
      mode: 'renderer-exact'
      identity: PtyMutationIdentity
      authorityAccess: TerminalSessionAuthorityPtyAccess
    }
  | {
      mode: 'runtime-exact'
      evidence: PtyAdministrativeMutationEvidence
      authorityAccess: TerminalSessionAuthorityPtyAccess
    }
  | { mode: 'unavailable' }

export type PtyMutationTarget = Readonly<{
  id: string
  providerRouteToken: object | null
  ptyLifecycleToken: object | null
  access: PtyMutationTargetAccess
}>

export function ptyMutationTargetsEqual(
  left: PtyMutationTarget,
  right: PtyMutationTarget
): boolean {
  if (
    left.id !== right.id ||
    left.providerRouteToken !== right.providerRouteToken ||
    left.ptyLifecycleToken !== right.ptyLifecycleToken ||
    left.access.mode !== right.access.mode
  ) {
    return false
  }
  if (left.access.mode === 'renderer-exact' && right.access.mode === 'renderer-exact') {
    return (
      left.access.identity.incarnationId === right.access.identity.incarnationId &&
      left.access.identity.paneGeneration === right.access.identity.paneGeneration &&
      left.access.identity.mutationLeaseId === right.access.identity.mutationLeaseId &&
      sameAuthorityAccess(left.access.authorityAccess, right.access.authorityAccess)
    )
  }
  if (left.access.mode === 'runtime-exact' && right.access.mode === 'runtime-exact') {
    return (
      left.access.evidence.incarnationId === right.access.evidence.incarnationId &&
      left.access.evidence.paneGeneration === right.access.evidence.paneGeneration &&
      sameAuthorityAccess(left.access.authorityAccess, right.access.authorityAccess)
    )
  }
  return true
}

function sameAuthorityAccess(
  left: TerminalSessionAuthorityPtyAccess,
  right: TerminalSessionAuthorityPtyAccess
): boolean {
  return sameTerminalSessionAuthorityPtyAccess(left, right)
}
