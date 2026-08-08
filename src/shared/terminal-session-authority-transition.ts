import {
  assertAuthorityId,
  terminalPaneGenerationKey,
  type TerminalAuthorityNamespace,
  type TerminalPaneGeneration,
  type TerminalSessionBinding
} from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalAuthorityOutcome,
  type TerminalPaneAuthorityRecord,
  type TerminalSessionAuthorityEffect,
  type TerminalSessionAuthorityMutationRequest,
  type TerminalSessionAuthorityMutationResult,
  type TerminalSessionPtyAllocation,
  type TerminalSessionPtyAllocationIdentity
} from './terminal-session-authority-mutation'
import {
  assertAllocationIdentity,
  assertMutationRequest,
  terminalAuthorityOutcomeByteLength
} from './terminal-session-authority-record-validation'
import {
  assertCurrentAllocationOwner,
  assertCurrentBindingOwner,
  assertReachableBindingOwner
} from './terminal-session-authority-owner-fence'
import {
  createPane,
  requireActive,
  requireExactPendingAllocation,
  requireExpectedClosedPane,
  requireExpectedPane,
  requireNoPendingAllocation,
  requireOpenBound,
  requireOpenUnbound,
  retire,
  terminalAuthorityOperationKey,
  terminalAuthorityPhysicalPtyKey,
  updatePaneRevision
} from './terminal-session-authority-transition-guards'

export { terminalAuthorityOperationKey, terminalAuthorityPhysicalPtyKey }

export type TerminalAuthorityTransitionView = Readonly<{
  namespace: TerminalAuthorityNamespace
  revision: number
  ownerIncarnationId: string
  pane: (pane: TerminalPaneGeneration) => TerminalPaneAuthorityRecord | null
  openPaneGenerationId: (paneKey: string) => string | null
  latestPaneGenerationId: (paneKey: string) => string | null
  allocation: (allocationId: string) => TerminalSessionPtyAllocation | null
  paneAllocation: (pane: TerminalPaneGeneration) => TerminalSessionPtyAllocation | null
  allocationConflict: (allocation: TerminalSessionPtyAllocationIdentity) => boolean
  ptyOwner: (binding: TerminalSessionBinding) => string | null
  ownerIsReachable: (ownerIncarnationId: string) => boolean
}>

export function deriveTerminalAuthorityOutcome(
  view: TerminalAuthorityTransitionView,
  request: TerminalSessionAuthorityMutationRequest,
  sequence: number,
  replayPersistedEvent = false
): TerminalAuthorityOutcome {
  assertMutationRequest(request)
  if (request.baseRevision !== view.revision) {
    failTerminalSessionAuthority('revision-conflict', 'mutation base revision is stale')
  }
  const result = deriveResult(view, request, replayPersistedEvent)
  const base = {
    sequence,
    outcomeId: request.outcomeId,
    request,
    result
  }
  return Object.freeze({ ...base, byteLength: terminalAuthorityOutcomeByteLength(base) })
}

function deriveResult(
  view: TerminalAuthorityTransitionView,
  request: TerminalSessionAuthorityMutationRequest,
  replayPersistedEvent: boolean
): TerminalSessionAuthorityMutationResult {
  const revision = view.revision + 1
  const change = request.change
  if (change.kind === 'create') {
    if (view.pane(change.pane) || view.latestPaneGenerationId(change.pane.paneKey)) {
      failTerminalSessionAuthority('expectation-mismatch', 'pane generation is not absent')
    }
    return result(view, request, revision, createPane(change.pane, revision))
  }

  const generation = 'allocation' in change ? change.allocation.pane : change.pane
  const current =
    change.kind === 'exit' && change.exit.retiredByClose
      ? requireExpectedClosedPane(view, generation, change.expected)
      : requireExpectedPane(view, generation, change.expected)
  if (change.kind === 'prepare-allocation') {
    requireOpenUnbound(current)
    assertAllocationIdentity(change.allocation)
    assertCurrentAllocationOwner(view, change.allocation.ownerIncarnationId, replayPersistedEvent)
    if (
      view.allocation(change.allocation.allocationId) ||
      view.allocationConflict(change.allocation)
    ) {
      failTerminalSessionAuthority('allocation-conflict', 'allocation identity is already reserved')
    }
    const pane = updatePaneRevision(current, revision)
    const allocation: TerminalSessionPtyAllocation = Object.freeze({
      ...change.allocation,
      pane: Object.freeze({ ...change.allocation.pane }),
      intentActorId: request.actorId,
      intentOperationId: request.operationId,
      preparedAtRevision: revision,
      status: 'pending',
      binding: null
    })
    return result(view, request, revision, pane, null, allocation)
  }

  if (change.kind === 'commit-allocation') {
    requireOpenUnbound(current)
    const pending = requireExactPendingAllocation(view, change.allocation)
    assertCurrentAllocationOwner(view, pending.ownerIncarnationId, replayPersistedEvent)
    assertAuthorityId(change.ptyIncarnationId, 'ptyIncarnationId')
    const binding = Object.freeze({
      ownerIncarnationId: pending.ownerIncarnationId,
      physicalPtyId: pending.physicalPtyId,
      ptyIncarnationId: change.ptyIncarnationId
    })
    const owner = view.ptyOwner(binding)
    if (owner && owner !== terminalPaneGenerationKey(current)) {
      failTerminalSessionAuthority('allocation-conflict', 'PTY incarnation is already bound')
    }
    const pane = Object.freeze({
      ...current,
      binding,
      lastBinding: binding,
      revision
    })
    const allocation: TerminalSessionPtyAllocation = Object.freeze({
      ...pending,
      status: 'committed',
      binding,
      committedAtRevision: revision
    })
    return result(view, request, revision, pane, null, allocation)
  }

  if (change.kind === 'cancel-allocation') {
    const pending = requireExactPendingAllocation(view, change.allocation)
    assertCurrentAllocationOwner(view, pending.ownerIncarnationId, replayPersistedEvent)
    return result(view, request, revision, updatePaneRevision(current, revision))
  }

  if (change.kind === 'close') {
    requireActive(current, 'close')
    assertCurrentBindingOwner(view, current.binding, replayPersistedEvent, 'close')
    requireNoPendingAllocation(view, change.pane)
    const pane = Object.freeze({ ...current, status: 'closed' as const, binding: null, revision })
    return result(view, request, revision, pane, null, null, retire('close', current.binding))
  }

  if (change.kind === 'supersede') {
    requireActive(current, 'supersede')
    assertCurrentBindingOwner(view, current.binding, replayPersistedEvent, 'supersede')
    requireNoPendingAllocation(view, change.pane)
    assertAuthorityId(change.replacementPaneGenerationId, 'replacementPaneGenerationId')
    if (
      change.replacementPaneGenerationId === current.paneGenerationId ||
      view.pane({ paneKey: current.paneKey, paneGenerationId: change.replacementPaneGenerationId })
    ) {
      failTerminalSessionAuthority('expectation-mismatch', 'replacement generation already exists')
    }
    const pane = Object.freeze({
      ...current,
      status: 'superseded' as const,
      binding: null,
      revision
    })
    const replacement = Object.freeze({
      ...createPane(
        { paneKey: current.paneKey, paneGenerationId: change.replacementPaneGenerationId },
        revision
      ),
      lastBinding: current.binding
    })
    return result(
      view,
      request,
      revision,
      pane,
      replacement,
      null,
      retire('supersede', current.binding)
    )
  }

  const exitBinding = change.expected.binding
  if (!exitBinding) {
    failTerminalSessionAuthority('expectation-mismatch', 'terminal exit binding is missing')
  }
  if (!change.exit.retiredByClose) {
    requireOpenBound(current)
  }
  assertReachableBindingOwner(view, exitBinding, replayPersistedEvent)
  const pane = Object.freeze({ ...current, status: 'exited' as const, binding: null, revision })
  const exit = Object.freeze({
    kind: 'terminal-exited' as const,
    binding: exitBinding,
    code: change.exit.code,
    signal: change.exit.signal
  })
  return result(
    view,
    request,
    revision,
    pane,
    null,
    null,
    change.exit.retiredByClose ? [exit] : [...retire('exit', exitBinding), exit]
  )
}

function result(
  view: TerminalAuthorityTransitionView,
  request: TerminalSessionAuthorityMutationRequest,
  revision: number,
  pane: TerminalPaneAuthorityRecord,
  replacementPane: TerminalPaneAuthorityRecord | null = null,
  allocation: TerminalSessionPtyAllocation | null = null,
  effects: readonly TerminalSessionAuthorityEffect[] = []
): TerminalSessionAuthorityMutationResult {
  return Object.freeze({
    namespace: view.namespace,
    actorId: request.actorId,
    operationId: request.operationId,
    kind: request.change.kind,
    revision,
    pane,
    replacementPane,
    allocation,
    effects: Object.freeze(effects)
  })
}
