import {
  assertAuthorityId,
  assertAuthorityNamespace,
  assertPaneGeneration,
  assertTerminalBinding,
  isRecord,
  type TerminalAuthorityNamespace
} from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalPaneAuthorityRecord,
  type TerminalSessionAuthorityMutationRequest,
  type TerminalSessionAuthorityMutationResult,
  type TerminalSessionPtyAllocation,
  type TerminalSessionPtyAllocationIdentity
} from './terminal-session-authority-mutation'
import { assertMutationResultMatchesChange } from './terminal-session-authority-result-validation'
export { assertSemanticFact } from './terminal-session-authority-semantic-fact-validation'

/** One canonical encoding: the outcome minus its own byte count. */
export function terminalAuthorityOutcomeByteLength(base: object): number {
  return new TextEncoder().encode(JSON.stringify(base)).byteLength
}

export function assertSafeInteger(
  value: unknown,
  field: string,
  minimum = 0
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    failTerminalSessionAuthority('record-corrupt', `${field} is invalid`)
  }
}

export function assertAllocationIdentity(
  value: unknown
): asserts value is TerminalSessionPtyAllocationIdentity {
  if (!isRecord(value)) {
    failTerminalSessionAuthority('record-corrupt', 'allocation identity is invalid')
  }
  assertAuthorityId(value.allocationId, 'allocationId')
  assertPaneGeneration(value.pane)
  assertAuthorityId(value.ownerIncarnationId, 'allocation ownerIncarnationId')
  assertAuthorityId(value.physicalPtyId, 'allocation physicalPtyId')
  assertAuthorityId(value.spawnFingerprint, 'allocation spawnFingerprint')
}

export function assertPaneRecord(value: unknown): asserts value is TerminalPaneAuthorityRecord {
  if (!isRecord(value)) {
    failTerminalSessionAuthority('record-corrupt', 'pane record is invalid')
  }
  const record = value
  assertAuthorityId(record.paneKey, 'paneKey')
  assertAuthorityId(record.paneGenerationId, 'paneGenerationId')
  if (!['open', 'closed', 'superseded', 'exited'].includes(String(record.status))) {
    failTerminalSessionAuthority('record-corrupt', 'pane status is invalid')
  }
  if (record.binding !== null) {
    assertTerminalBinding(record.binding)
  }
  if (record.lastBinding !== null) {
    assertTerminalBinding(record.lastBinding)
  }
  assertSafeInteger(record.revision, 'pane revision', 1)
  if (record.status !== 'open' && record.binding !== null) {
    failTerminalSessionAuthority('record-corrupt', 'inactive pane retains a live binding')
  }
}

export function assertAllocationRecord(
  value: unknown
): asserts value is TerminalSessionPtyAllocation {
  if (!isRecord(value)) {
    failTerminalSessionAuthority('record-corrupt', 'allocation is invalid')
  }
  const record = value
  assertAllocationIdentity({
    allocationId: record.allocationId,
    pane: record.pane,
    ownerIncarnationId: record.ownerIncarnationId,
    physicalPtyId: record.physicalPtyId,
    spawnFingerprint: record.spawnFingerprint
  })
  assertAuthorityId(record.intentActorId, 'allocation intentActorId')
  assertAuthorityId(record.intentOperationId, 'allocation intentOperationId')
  assertSafeInteger(record.preparedAtRevision, 'allocation prepared revision', 1)
  if (record.status === 'pending') {
    if (record.binding !== null) {
      failTerminalSessionAuthority('record-corrupt', 'pending allocation has a binding')
    }
    return
  }
  if (record.status !== 'committed') {
    failTerminalSessionAuthority('record-corrupt', 'allocation status is invalid')
  }
  assertTerminalBinding(record.binding)
  assertSafeInteger(record.committedAtRevision, 'allocation committed revision', 1)
  if (
    record.committedAtRevision < record.preparedAtRevision ||
    record.binding.ownerIncarnationId !== record.ownerIncarnationId ||
    record.binding.physicalPtyId !== record.physicalPtyId
  ) {
    failTerminalSessionAuthority('record-corrupt', 'committed allocation identity changed')
  }
}

export function assertMutationRequest(
  value: unknown
): asserts value is TerminalSessionAuthorityMutationRequest {
  if (!isRecord(value) || !isRecord(value.change)) {
    failTerminalSessionAuthority('record-corrupt', 'mutation request is invalid')
  }
  assertAuthorityId(value.actorId, 'actorId')
  assertAuthorityId(value.operationId, 'operationId')
  assertSafeInteger(value.baseRevision, 'baseRevision')
  assertAuthorityId(value.outcomeId, 'outcomeId')
  assertChange(value.change)
}

export function assertMutationResultSemantics(
  namespace: TerminalAuthorityNamespace,
  request: TerminalSessionAuthorityMutationRequest,
  result: unknown
): asserts result is TerminalSessionAuthorityMutationResult {
  if (!isRecord(result)) {
    failTerminalSessionAuthority('record-corrupt', 'mutation result is invalid')
  }
  assertAuthorityNamespace(result.namespace)
  if (!sameNamespace(namespace, result.namespace)) {
    failTerminalSessionAuthority('record-corrupt', 'mutation result namespace changed')
  }
  if (
    result.actorId !== request.actorId ||
    result.operationId !== request.operationId ||
    result.kind !== request.change.kind
  ) {
    failTerminalSessionAuthority('record-corrupt', 'mutation result identity changed')
  }
  assertSafeInteger(result.revision, 'result revision', 1)
  assertPaneRecord(result.pane)
  if (result.replacementPane !== null) {
    assertPaneRecord(result.replacementPane)
  }
  if (result.allocation !== null) {
    assertAllocationRecord(result.allocation)
  }
  if (!Array.isArray(result.effects)) {
    failTerminalSessionAuthority('record-corrupt', 'mutation effects are invalid')
  }
  for (const effect of result.effects) {
    assertEffect(effect)
  }
  assertMutationResultMatchesChange(
    request.change,
    result as TerminalSessionAuthorityMutationResult
  )
}

function assertChange(change: Record<string, unknown>): void {
  if (change.kind === 'create') {
    assertPaneGeneration(change.pane)
    return
  }
  if (
    ![
      'prepare-allocation',
      'commit-allocation',
      'cancel-allocation',
      'close',
      'supersede',
      'exit'
    ].includes(String(change.kind))
  ) {
    failTerminalSessionAuthority('record-corrupt', 'mutation kind is invalid')
  }
  assertExpectation(change.expected)
  if (String(change.kind).includes('allocation')) {
    assertAllocationIdentity(change.allocation)
  } else {
    assertPaneGeneration(change.pane)
  }
  if (change.kind === 'commit-allocation') {
    assertAuthorityId(change.ptyIncarnationId, 'ptyIncarnationId')
  } else if (change.kind === 'supersede') {
    assertAuthorityId(change.replacementPaneGenerationId, 'replacementPaneGenerationId')
  } else if (change.kind === 'exit') {
    assertExit(change.exit)
  }
}

function assertExpectation(value: unknown): void {
  if (!isRecord(value)) {
    failTerminalSessionAuthority('record-corrupt', 'terminal expectation is invalid')
  }
  assertAuthorityId(value.paneGenerationId, 'expected paneGenerationId')
  if (value.binding !== null) {
    assertTerminalBinding(value.binding)
  }
}

function assertExit(value: unknown): void {
  if (!isRecord(value)) {
    failTerminalSessionAuthority('record-corrupt', 'terminal exit is invalid')
  }
  if (value.retiredByClose !== undefined && value.retiredByClose !== true) {
    failTerminalSessionAuthority('record-corrupt', 'terminal exit close retirement is invalid')
  }
  if (value.code !== null) {
    assertSafeInteger(value.code, 'exit code')
  }
  if (value.signal !== null) {
    assertAuthorityId(value.signal, 'exit signal')
  }
}

function assertEffect(value: unknown): void {
  if (!isRecord(value) || !['binding-retired', 'terminal-exited'].includes(String(value.kind))) {
    failTerminalSessionAuthority('record-corrupt', 'terminal effect is invalid')
  }
  assertTerminalBinding(value.binding)
  if (value.kind === 'binding-retired') {
    if (!['close', 'supersede', 'exit'].includes(String(value.reason))) {
      failTerminalSessionAuthority('record-corrupt', 'binding retirement reason is invalid')
    }
    return
  }
  assertExit(value)
}

function sameNamespace(
  left: TerminalAuthorityNamespace,
  right: TerminalAuthorityNamespace
): boolean {
  return left.authorityHostId === right.authorityHostId && left.namespaceId === right.namespaceId
}
