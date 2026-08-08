import {
  sameTerminalBinding,
  terminalPaneGenerationKey,
  type TerminalPaneGeneration,
  type TerminalSessionBinding
} from './terminal-session-authority-identity'
import { failTerminalSessionAuthority } from './terminal-session-authority-mutation'
import type {
  TerminalPaneAuthorityRecord,
  TerminalSessionAuthorityEffect,
  TerminalSessionExpectation,
  TerminalSessionPtyAllocation,
  TerminalSessionPtyAllocationIdentity
} from './terminal-session-authority-mutation'
import type { TerminalAuthorityTransitionView } from './terminal-session-authority-transition'

export function requireExpectedPane(
  view: TerminalAuthorityTransitionView,
  generation: TerminalPaneGeneration,
  expected: TerminalSessionExpectation
): TerminalPaneAuthorityRecord {
  const pane = view.pane(generation)
  if (
    !pane ||
    expected.paneGenerationId !== generation.paneGenerationId ||
    !sameTerminalBinding(expected.binding, pane.binding)
  ) {
    failTerminalSessionAuthority('expectation-mismatch', 'pane generation or binding changed')
  }
  return pane
}

export function requireExpectedClosedPane(
  view: TerminalAuthorityTransitionView,
  generation: TerminalPaneGeneration,
  expected: TerminalSessionExpectation
): TerminalPaneAuthorityRecord {
  const pane = view.pane(generation)
  if (
    !pane ||
    pane.status !== 'closed' ||
    pane.binding !== null ||
    expected.paneGenerationId !== generation.paneGenerationId ||
    expected.binding === null ||
    !sameTerminalBinding(expected.binding, pane.lastBinding)
  ) {
    failTerminalSessionAuthority('expectation-mismatch', 'closed pane binding changed before exit')
  }
  return pane
}

export function requireExactPendingAllocation(
  view: TerminalAuthorityTransitionView,
  expected: TerminalSessionPtyAllocationIdentity
): TerminalSessionPtyAllocation {
  const allocation = view.allocation(expected.allocationId)
  if (allocation?.status !== 'pending' || !sameAllocation(allocation, expected)) {
    failTerminalSessionAuthority('allocation-conflict', 'pending allocation changed')
  }
  return allocation
}

export function requireOpenUnbound(pane: TerminalPaneAuthorityRecord): void {
  if (pane.status !== 'open' || pane.binding !== null) {
    failTerminalSessionAuthority('expectation-mismatch', 'pane is not open and unbound')
  }
}

export function requireOpenBound(
  pane: TerminalPaneAuthorityRecord
): asserts pane is TerminalPaneAuthorityRecord & { binding: TerminalSessionBinding } {
  if (pane.status !== 'open' || pane.binding === null) {
    failTerminalSessionAuthority('expectation-mismatch', 'pane is not an exact live binding')
  }
}

export function requireActive(pane: TerminalPaneAuthorityRecord, operation: string): void {
  if (pane.status === 'closed' || pane.status === 'superseded') {
    failTerminalSessionAuthority('expectation-mismatch', `cannot ${operation} an inactive pane`)
  }
}

export function requireNoPendingAllocation(
  view: TerminalAuthorityTransitionView,
  pane: TerminalPaneGeneration
): void {
  if (view.paneAllocation(pane)?.status === 'pending') {
    failTerminalSessionAuthority('allocation-conflict', 'pending allocation must be canceled first')
  }
}

export function createPane(
  pane: TerminalPaneGeneration,
  revision: number
): TerminalPaneAuthorityRecord {
  return Object.freeze({ ...pane, status: 'open', binding: null, lastBinding: null, revision })
}

export function updatePaneRevision(
  pane: TerminalPaneAuthorityRecord,
  revision: number
): TerminalPaneAuthorityRecord {
  return Object.freeze({ ...pane, revision })
}

export function retire(
  reason: 'close' | 'supersede' | 'exit',
  binding: TerminalSessionBinding | null
): readonly TerminalSessionAuthorityEffect[] {
  return binding ? [Object.freeze({ kind: 'binding-retired', reason, binding })] : []
}

function sameAllocation(
  left: TerminalSessionPtyAllocationIdentity,
  right: TerminalSessionPtyAllocationIdentity
): boolean {
  return (
    left.allocationId === right.allocationId &&
    terminalPaneGenerationKey(left.pane) === terminalPaneGenerationKey(right.pane) &&
    left.ownerIncarnationId === right.ownerIncarnationId &&
    left.physicalPtyId === right.physicalPtyId &&
    left.spawnFingerprint === right.spawnFingerprint
  )
}

export function terminalAuthorityPhysicalPtyKey(
  ownerIncarnationId: string,
  physicalPtyId: string
): string {
  return JSON.stringify([ownerIncarnationId, physicalPtyId])
}

export function terminalAuthorityOperationKey(actorId: string, operationId: string): string {
  return JSON.stringify([actorId, operationId])
}
