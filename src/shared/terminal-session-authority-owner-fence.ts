import type { TerminalSessionBinding } from './terminal-session-authority-identity'
import { failTerminalSessionAuthority } from './terminal-session-authority-mutation'

type TerminalAuthorityOwnerFenceView = Readonly<{
  ownerIncarnationId: string
  ownerIsReachable: (ownerIncarnationId: string) => boolean
}>

export function assertCurrentAllocationOwner(
  view: TerminalAuthorityOwnerFenceView,
  ownerIncarnationId: string,
  replayPersistedEvent: boolean
): void {
  if (!replayPersistedEvent && ownerIncarnationId !== view.ownerIncarnationId) {
    failTerminalSessionAuthority('allocation-conflict', 'allocation owner is unreachable')
  }
}

export function assertCurrentBindingOwner(
  view: TerminalAuthorityOwnerFenceView,
  binding: TerminalSessionBinding | null,
  replayPersistedEvent: boolean,
  operation: 'close' | 'supersede'
): void {
  if (
    !replayPersistedEvent &&
    binding !== null &&
    binding.ownerIncarnationId !== view.ownerIncarnationId
  ) {
    failTerminalSessionAuthority(
      'expectation-mismatch',
      `cannot ${operation} a binding owned by another incarnation`
    )
  }
}

export function assertReachableBindingOwner(
  view: TerminalAuthorityOwnerFenceView,
  binding: TerminalSessionBinding,
  replayPersistedEvent: boolean
): void {
  if (!replayPersistedEvent && !view.ownerIsReachable(binding.ownerIncarnationId)) {
    failTerminalSessionAuthority(
      'expectation-mismatch',
      'an unreachable owner cannot publish terminal exit'
    )
  }
}
