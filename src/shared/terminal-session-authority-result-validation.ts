import {
  sameTerminalBinding,
  type TerminalSessionBinding
} from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalSessionAuthorityChange,
  type TerminalSessionAuthorityMutationResult,
  type TerminalSessionPtyAllocationIdentity
} from './terminal-session-authority-mutation'

export function assertMutationResultMatchesChange(
  change: TerminalSessionAuthorityChange,
  result: TerminalSessionAuthorityMutationResult
): void {
  const pane = 'allocation' in change ? change.allocation.pane : change.pane
  requireResult(
    result.pane.paneKey === pane.paneKey &&
      result.pane.paneGenerationId === pane.paneGenerationId &&
      result.pane.revision === result.revision,
    'mutation result pane changed'
  )
  if (change.kind === 'create') {
    requireResult(
      result.pane.status === 'open' &&
        result.pane.binding === null &&
        result.pane.lastBinding === null &&
        result.replacementPane === null &&
        result.allocation === null &&
        result.effects.length === 0,
      'create result is not canonical'
    )
    return
  }
  if (change.kind === 'prepare-allocation') {
    requireResult(
      result.pane.status === 'open' &&
        sameTerminalBinding(result.pane.binding, change.expected.binding) &&
        result.replacementPane === null &&
        result.allocation?.status === 'pending' &&
        sameAllocation(result.allocation, change.allocation) &&
        result.allocation.intentActorId === result.actorId &&
        result.allocation.intentOperationId === result.operationId &&
        result.allocation.preparedAtRevision === result.revision &&
        result.effects.length === 0,
      'allocation intent result is not canonical'
    )
    return
  }
  if (change.kind === 'commit-allocation') {
    assertCommittedBinding(change.allocation, change.ptyIncarnationId, result.pane.binding)
    requireResult(
      result.pane.status === 'open' &&
        result.replacementPane === null &&
        result.allocation?.status === 'committed' &&
        sameAllocation(result.allocation, change.allocation) &&
        sameTerminalBinding(result.allocation.binding, result.pane.binding) &&
        result.allocation.committedAtRevision === result.revision &&
        result.effects.length === 0,
      'allocation commit result is not canonical'
    )
    return
  }
  if (change.kind === 'cancel-allocation') {
    requireResult(
      result.replacementPane === null && result.allocation === null && result.effects.length === 0,
      'allocation cancellation result is not canonical'
    )
    return
  }
  if (change.kind === 'close') {
    requireResult(
      result.pane.status === 'closed' &&
        result.pane.binding === null &&
        result.replacementPane === null &&
        result.allocation === null &&
        exactRetirement(result, 'close', change.expected.binding),
      'close result is not canonical'
    )
    return
  }
  if (change.kind === 'supersede') {
    requireResult(
      result.pane.status === 'superseded' &&
        result.pane.binding === null &&
        result.replacementPane?.paneKey === pane.paneKey &&
        result.replacementPane.paneGenerationId === change.replacementPaneGenerationId &&
        result.replacementPane.status === 'open' &&
        result.replacementPane.binding === null &&
        sameTerminalBinding(result.replacementPane.lastBinding, change.expected.binding) &&
        result.replacementPane.revision === result.revision &&
        result.allocation === null &&
        exactRetirement(result, 'supersede', change.expected.binding),
      'supersede result is not canonical'
    )
    return
  }
  const exitEffect = change.exit.retiredByClose ? result.effects[0] : result.effects[1]
  requireResult(
    result.pane.status === 'exited' &&
      result.pane.binding === null &&
      result.replacementPane === null &&
      result.allocation === null &&
      change.expected.binding !== null &&
      (change.exit.retiredByClose
        ? result.effects.length === 1
        : result.effects.length === 2 &&
          result.effects[0]?.kind === 'binding-retired' &&
          result.effects[0].reason === 'exit' &&
          sameTerminalBinding(result.effects[0].binding, change.expected.binding)) &&
      exitEffect?.kind === 'terminal-exited' &&
      sameTerminalBinding(exitEffect.binding, change.expected.binding) &&
      exitEffect.code === change.exit.code &&
      exitEffect.signal === change.exit.signal,
    'exit result is not canonical'
  )
}

function exactRetirement(
  result: TerminalSessionAuthorityMutationResult,
  reason: 'close' | 'supersede',
  binding: TerminalSessionBinding | null
): boolean {
  if (!binding) {
    return result.effects.length === 0
  }
  const effect = result.effects[0]
  return (
    result.effects.length === 1 &&
    effect?.kind === 'binding-retired' &&
    effect.reason === reason &&
    sameTerminalBinding(effect.binding, binding)
  )
}

function sameAllocation(
  left: TerminalSessionPtyAllocationIdentity,
  right: TerminalSessionPtyAllocationIdentity
): boolean {
  return (
    left.allocationId === right.allocationId &&
    left.pane.paneKey === right.pane.paneKey &&
    left.pane.paneGenerationId === right.pane.paneGenerationId &&
    left.ownerIncarnationId === right.ownerIncarnationId &&
    left.physicalPtyId === right.physicalPtyId &&
    left.spawnFingerprint === right.spawnFingerprint
  )
}

function assertCommittedBinding(
  allocation: TerminalSessionPtyAllocationIdentity,
  ptyIncarnationId: string,
  binding: TerminalSessionBinding | null
): void {
  requireResult(
    Boolean(
      binding &&
      binding.ownerIncarnationId === allocation.ownerIncarnationId &&
      binding.physicalPtyId === allocation.physicalPtyId &&
      binding.ptyIncarnationId === ptyIncarnationId
    ),
    'allocation result binding changed'
  )
}

function requireResult(condition: boolean, message: string): void {
  if (!condition) {
    failTerminalSessionAuthority('record-corrupt', message)
  }
}
