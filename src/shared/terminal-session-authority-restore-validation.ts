import {
  assertAuthorityId,
  isRecord,
  sameTerminalBinding,
  type TerminalAuthorityNamespace
} from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalPaneAuthorityRecord,
  type TerminalAuthorityConsumerSnapshot,
  type TerminalAuthorityDurableOutcome,
  type TerminalAuthoritySemanticOutcome,
  type TerminalAuthoritySemanticProducerSnapshot,
  type TerminalSessionPtyAllocation,
  type TerminalSessionPtyAllocationIdentity
} from './terminal-session-authority-mutation'
import { parseTerminalSessionAuthorityPtyAccess } from './terminal-session-authority-pty-access'
import {
  assertAllocationRecord,
  assertMutationRequest,
  assertMutationResultSemantics,
  assertPaneRecord,
  assertSafeInteger,
  assertSemanticFact,
  terminalAuthorityOutcomeByteLength
} from './terminal-session-authority-record-validation'
import type { TerminalAuthorityTransitionView } from './terminal-session-authority-transition'

type TerminalAuthorityTopologyRestoreView = Pick<
  TerminalAuthorityTransitionView,
  'pane' | 'openPaneGenerationId' | 'allocation' | 'allocationConflict' | 'ptyOwner'
> &
  Readonly<{
    hasIntent: (actorId: string, operationId: string) => boolean
  }>

export function assertRestorableTerminalAuthorityPane(
  pane: TerminalPaneAuthorityRecord,
  revision: number,
  view: TerminalAuthorityTopologyRestoreView
): void {
  assertPaneRecord(pane)
  if (pane.revision > revision || view.pane(pane)) {
    failTerminalSessionAuthority('record-corrupt', 'snapshot pane is inconsistent')
  }
  if (pane.status === 'open' && view.openPaneGenerationId(pane.paneKey)) {
    failTerminalSessionAuthority('record-corrupt', 'snapshot has two open pane generations')
  }
  if (pane.binding && view.ptyOwner(pane.binding)) {
    failTerminalSessionAuthority('record-corrupt', 'snapshot binds one PTY incarnation twice')
  }
}

export function assertRestorableTerminalAuthorityAllocation(
  allocation: TerminalSessionPtyAllocation,
  revision: number,
  view: TerminalAuthorityTopologyRestoreView
): void {
  assertAllocationRecord(allocation)
  const pane = view.pane(allocation.pane)
  if (
    !pane ||
    allocation.preparedAtRevision > revision ||
    view.allocation(allocation.allocationId) ||
    view.allocationConflict(allocation as TerminalSessionPtyAllocationIdentity) ||
    view.hasIntent(allocation.intentActorId, allocation.intentOperationId)
  ) {
    failTerminalSessionAuthority('record-corrupt', 'snapshot allocation is inconsistent')
  }
  if (
    (allocation.status === 'pending' && (pane.status !== 'open' || pane.binding !== null)) ||
    (allocation.status === 'committed' &&
      (allocation.committedAtRevision > revision ||
        pane.status !== 'open' ||
        !sameTerminalBinding(pane.binding, allocation.binding)))
  ) {
    failTerminalSessionAuthority('record-corrupt', 'allocation lost its exact open pane')
  }
}

export function assertConsumerSnapshotShape(snapshot: TerminalAuthorityConsumerSnapshot): void {
  if (!isRecord(snapshot)) {
    failTerminalSessionAuthority('record-corrupt', 'consumer snapshot is invalid')
  }
  assertAuthorityId(snapshot.consumerId, 'consumerId')
  assertAuthorityId(snapshot.activeIncarnationId, 'consumerIncarnationId')
  assertSafeInteger(snapshot.acknowledgedSequence, 'acknowledged sequence')
}

export function validateRestoredOutcome(
  outcome: TerminalAuthorityDurableOutcome,
  namespace: TerminalAuthorityNamespace,
  revision: number
): void {
  if (!isRecord(outcome)) {
    failTerminalSessionAuthority('record-corrupt', 'outcome is invalid')
  }
  assertAuthorityId(outcome.outcomeId, 'outcomeId')
  assertSafeInteger(outcome.sequence, 'outcome sequence', 1)
  const { byteLength: _byteLength, ...base } = outcome
  if (
    outcome.byteLength !== terminalAuthorityOutcomeByteLength(base) ||
    restoredOutcomeRevision(outcome, namespace) > revision
  ) {
    failTerminalSessionAuthority('record-corrupt', 'outcome snapshot is inconsistent')
  }
}

function restoredOutcomeRevision(
  outcome: TerminalAuthorityDurableOutcome,
  namespace: TerminalAuthorityNamespace
): number {
  if (outcome.kind === 'semantic') {
    assertSemanticOutcomeShape(outcome, namespace)
    return outcome.appendedAtRevision
  }
  assertMutationRequest(outcome.request)
  assertMutationResultSemantics(namespace, outcome.request, outcome.result)
  if (outcome.request.outcomeId !== outcome.outcomeId) {
    failTerminalSessionAuthority('record-corrupt', 'outcome snapshot is inconsistent')
  }
  return outcome.result.revision
}

export function assertSemanticProducerSnapshotShape(
  snapshot: TerminalAuthoritySemanticProducerSnapshot,
  namespace: TerminalAuthorityNamespace
): void {
  if (!isRecord(snapshot)) {
    failTerminalSessionAuthority('record-corrupt', 'semantic producer cursor is invalid')
  }
  const access = parseTerminalSessionAuthorityPtyAccess(snapshot.access)
  if (
    !access ||
    access.namespace.authorityHostId !== namespace.authorityHostId ||
    access.namespace.namespaceId !== namespace.namespaceId
  ) {
    failTerminalSessionAuthority('record-corrupt', 'semantic producer access is invalid')
  }
  assertAuthorityId(snapshot.producerIncarnationId, 'producerIncarnationId')
  assertSafeInteger(snapshot.producerSequence, 'producer sequence', 1)
}

function assertSemanticOutcomeShape(
  outcome: TerminalAuthoritySemanticOutcome,
  namespace: TerminalAuthorityNamespace
): void {
  const access = parseTerminalSessionAuthorityPtyAccess(outcome.access)
  if (
    !access ||
    access.namespace.authorityHostId !== namespace.authorityHostId ||
    access.namespace.namespaceId !== namespace.namespaceId
  ) {
    failTerminalSessionAuthority('record-corrupt', 'semantic outcome access is invalid')
  }
  assertAuthorityId(outcome.producerIncarnationId, 'producerIncarnationId')
  assertSafeInteger(outcome.producerSequence, 'outcome producer sequence', 1)
  assertSafeInteger(outcome.appendedAtRevision, 'semantic outcome revision')
  assertSemanticFact(outcome.fact)
}
