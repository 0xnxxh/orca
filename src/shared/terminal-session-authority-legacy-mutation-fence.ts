import type {
  TerminalLegacyRecoveryProjection,
  TerminalLegacyUnresolvedCandidate,
  TerminalLegacyUnresolvedRecovery
} from './terminal-legacy-cutover'
import type { TerminalSessionBinding } from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalPaneAuthorityRecord,
  type TerminalSessionAuthorityErrorCode,
  type TerminalSessionAuthorityMutationRequest,
  type TerminalSessionPtyAllocation,
  type TerminalSessionPtyAllocationIdentity
} from './terminal-session-authority-mutation'

type LegacyUnresolvedIdentity = Pick<
  TerminalLegacyUnresolvedCandidate | TerminalLegacyUnresolvedRecovery,
  'physicalPty' | 'inventoryEvidence'
>

type LegacyWorkerOwner = (workerId: string) => string | null

export function assertTerminalAuthorityLegacyMutationAllowed(
  request: TerminalSessionAuthorityMutationRequest,
  recoveries: Iterable<TerminalLegacyRecoveryProjection>,
  workerOwner: LegacyWorkerOwner
): void {
  const pane = 'allocation' in request.change ? request.change.allocation.pane : request.change.pane
  const allocation = 'allocation' in request.change ? request.change.allocation : null
  const binding = 'expected' in request.change ? request.change.expected.binding : null
  for (const recovery of recoveries) {
    if (recovery.status !== 'unresolved') {
      continue
    }
    if (recovery.inventoryEvidence.paneKey === pane.paneKey) {
      failTerminalSessionAuthority(
        'expectation-mismatch',
        'unresolved legacy recovery fences the pane identity'
      )
    }
    if (allocation && physicalPtyMatches(recovery, allocation, workerOwner)) {
      failTerminalSessionAuthority(
        'allocation-conflict',
        'unresolved legacy recovery fences the physical PTY identity'
      )
    }
    if (binding && bindingMatches(recovery, binding, workerOwner)) {
      failTerminalSessionAuthority(
        'expectation-mismatch',
        'unresolved legacy recovery fences the PTY binding identity'
      )
    }
  }
}

export function assertTerminalAuthorityLegacyTopologyAllowed(
  unresolved: readonly LegacyUnresolvedIdentity[],
  importedPaneKeys: readonly string[],
  panes: readonly TerminalPaneAuthorityRecord[],
  allocations: readonly TerminalSessionPtyAllocation[],
  workerOwner: LegacyWorkerOwner,
  errorCode: TerminalSessionAuthorityErrorCode
): void {
  for (const recovery of unresolved) {
    const paneConflict =
      panes.some(
        (pane) =>
          recovery.inventoryEvidence.paneKey === pane.paneKey ||
          (pane.binding !== null && bindingMatches(recovery, pane.binding, workerOwner))
      ) || importedPaneKeys.includes(recovery.inventoryEvidence.paneKey ?? '')
    const allocationConflict = allocations.some((allocation) =>
      physicalPtyMatches(recovery, allocation, workerOwner)
    )
    if (paneConflict || allocationConflict) {
      failTerminalSessionAuthority(
        errorCode,
        'unresolved legacy recovery conflicts with authoritative topology'
      )
    }
  }
}

function physicalPtyMatches(
  recovery: LegacyUnresolvedIdentity,
  allocation: TerminalSessionPtyAllocationIdentity,
  workerOwner: LegacyWorkerOwner
): boolean {
  const ownerIncarnationId = workerOwner(recovery.physicalPty.workerId)
  return (
    ownerIncarnationId !== null &&
    allocation.ownerIncarnationId === ownerIncarnationId &&
    allocation.physicalPtyId === recovery.physicalPty.physicalPtyId
  )
}

function bindingMatches(
  recovery: LegacyUnresolvedIdentity,
  binding: TerminalSessionBinding,
  workerOwner: LegacyWorkerOwner
): boolean {
  const ownerIncarnationId = workerOwner(recovery.physicalPty.workerId)
  return (
    ownerIncarnationId !== null &&
    binding.ownerIncarnationId === ownerIncarnationId &&
    binding.physicalPtyId === recovery.physicalPty.physicalPtyId &&
    (recovery.physicalPty.ptyIncarnationId === null ||
      binding.ptyIncarnationId === recovery.physicalPty.ptyIncarnationId)
  )
}
