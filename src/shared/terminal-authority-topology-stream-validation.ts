import {
  assertAuthorityId,
  assertAuthorityNamespace,
  isRecord,
  terminalPaneGenerationKey,
  type TerminalAuthorityNamespace
} from './terminal-session-authority-identity'
import {
  TERMINAL_AUTHORITY_TOPOLOGY_MAX_CHANGE_BYTES,
  TERMINAL_AUTHORITY_TOPOLOGY_MAX_CHANGE_OPERATIONS,
  TERMINAL_AUTHORITY_TOPOLOGY_MAX_PANES,
  TERMINAL_AUTHORITY_TOPOLOGY_MAX_REQUEST_BYTES,
  TERMINAL_AUTHORITY_TOPOLOGY_MAX_SNAPSHOT_BYTES,
  TERMINAL_AUTHORITY_TOPOLOGY_STREAM_VERSION,
  type TerminalAuthorityTopologyChange,
  type TerminalAuthorityTopologyPaneChange,
  type TerminalAuthorityTopologySnapshot,
  type TerminalAuthorityTopologySnapshotRequest
} from './terminal-authority-topology-stream-contract'
import {
  TerminalAuthorityTopologyStreamValidationError,
  failTerminalAuthorityTopologyStreamValidation as reject
} from './terminal-authority-topology-stream-errors'
import {
  assertTerminalAuthorityTopologyPanes,
  parseTerminalAuthorityRecoveryNoticeProjection,
  parseTerminalAuthorityTopologyPane,
  parseTerminalAuthorityTopologyPaneGeneration
} from './terminal-authority-topology-record-validation'

export { TerminalAuthorityTopologyStreamValidationError }

export type ParsedTerminalAuthorityTopologyChange = Readonly<{
  value: TerminalAuthorityTopologyChange
  byteLength: number
}>

function safeInteger(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    reject(`${field} is invalid`)
  }
  return Number(value)
}

function jsonByteLengthWithin(value: unknown, limit: number, field: string): number {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    reject(`${field} is not JSON serializable`)
  }
  if (serialized === undefined) {
    reject(`${field} is not JSON serializable`)
  }
  const byteLength = new TextEncoder().encode(serialized).byteLength
  if (byteLength > limit) {
    reject(`${field} exceeds its byte capacity`)
  }
  return byteLength
}

function namespace(value: unknown): TerminalAuthorityNamespace {
  assertAuthorityNamespace(value)
  return Object.freeze({
    authorityHostId: value.authorityHostId,
    namespaceId: value.namespaceId
  })
}

function assertProtocolHeader(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value) || value.protocolVersion !== TERMINAL_AUTHORITY_TOPOLOGY_STREAM_VERSION) {
    reject('terminal authority topology protocol version is invalid')
  }
}

function topologyHeader(value: Record<string, unknown>): {
  subscriptionId: string
  streamIncarnationId: string
  namespace: TerminalAuthorityNamespace
  writerEpoch: number
} {
  assertAuthorityId(value.subscriptionId, 'subscriptionId')
  assertAuthorityId(value.streamIncarnationId, 'streamIncarnationId')
  return {
    subscriptionId: value.subscriptionId,
    streamIncarnationId: value.streamIncarnationId,
    namespace: namespace(value.namespace),
    writerEpoch: safeInteger(value.writerEpoch, 'topology writer epoch', 1)
  }
}

export function parseTerminalAuthorityTopologySnapshotRequest(
  value: unknown
): TerminalAuthorityTopologySnapshotRequest {
  jsonByteLengthWithin(value, TERMINAL_AUTHORITY_TOPOLOGY_MAX_REQUEST_BYTES, 'topology request')
  assertProtocolHeader(value)
  assertAuthorityId(value.subscriptionId, 'subscriptionId')
  return Object.freeze({
    protocolVersion: 1,
    subscriptionId: value.subscriptionId,
    namespace: namespace(value.namespace)
  })
}

export function parseTerminalAuthorityTopologySnapshot(
  value: unknown
): TerminalAuthorityTopologySnapshot {
  jsonByteLengthWithin(value, TERMINAL_AUTHORITY_TOPOLOGY_MAX_SNAPSHOT_BYTES, 'topology snapshot')
  assertProtocolHeader(value)
  const header = topologyHeader(value)
  if (!Array.isArray(value.panes)) {
    reject('terminal authority topology snapshot shape is invalid')
  }
  if (value.panes.length > TERMINAL_AUTHORITY_TOPOLOGY_MAX_PANES) {
    reject('terminal authority topology snapshot capacity exceeded')
  }
  const authorityRevision = safeInteger(value.authorityRevision, 'topology authority revision')
  const panes = value.panes.map(parseTerminalAuthorityTopologyPane)
  assertTerminalAuthorityTopologyPanes(panes, authorityRevision)
  return Object.freeze({
    protocolVersion: 1,
    ...header,
    authorityRevision,
    appliedChangeSequence: safeInteger(
      value.appliedChangeSequence,
      'topology applied change sequence'
    ),
    panes: Object.freeze(panes),
    namespaceRecoveryNotices: parseTerminalAuthorityRecoveryNoticeProjection(
      value.namespaceRecoveryNotices
    )
  })
}

function paneChange(value: unknown): TerminalAuthorityTopologyPaneChange {
  if (!isRecord(value)) {
    reject('topology pane change is invalid')
  }
  if (value.kind === 'upsert') {
    return Object.freeze({ kind: 'upsert', pane: parseTerminalAuthorityTopologyPane(value.pane) })
  }
  if (value.kind === 'remove') {
    return Object.freeze({
      kind: 'remove',
      pane: parseTerminalAuthorityTopologyPaneGeneration(value.pane)
    })
  }
  reject('topology pane change kind is invalid')
}

function assertUniqueChangeKeys(change: TerminalAuthorityTopologyChange): void {
  const paneKeys = new Set<string>()
  for (const operation of change.paneChanges) {
    const key = terminalPaneGenerationKey(operation.pane)
    if (paneKeys.has(key)) {
      reject('topology pane change is duplicated')
    }
    paneKeys.add(key)
  }
}

export function parseTerminalAuthorityTopologyChangeWithByteLength(
  value: unknown
): ParsedTerminalAuthorityTopologyChange {
  const byteLength = jsonByteLengthWithin(
    value,
    TERMINAL_AUTHORITY_TOPOLOGY_MAX_CHANGE_BYTES,
    'topology change'
  )
  assertProtocolHeader(value)
  const header = topologyHeader(value)
  if (!Array.isArray(value.paneChanges)) {
    reject('terminal authority topology change shape is invalid')
  }
  if (value.paneChanges.length > TERMINAL_AUTHORITY_TOPOLOGY_MAX_CHANGE_OPERATIONS) {
    reject('terminal authority topology change capacity exceeded')
  }
  const baseAuthorityRevision = safeInteger(
    value.baseAuthorityRevision,
    'topology base authority revision'
  )
  const authorityRevision = safeInteger(
    value.authorityRevision,
    'topology authority revision',
    baseAuthorityRevision
  )
  const paneChanges = value.paneChanges.map(paneChange)
  const hasRecoveryNotices = value.namespaceRecoveryNotices !== undefined
  if (paneChanges.length === 0 && !hasRecoveryNotices) {
    reject('terminal authority topology change is empty')
  }
  for (const operation of paneChanges) {
    if (operation.kind === 'upsert' && operation.pane.revision > authorityRevision) {
      reject('topology pane change exceeds authority revision')
    }
  }
  const change: TerminalAuthorityTopologyChange = Object.freeze({
    protocolVersion: 1,
    ...header,
    baseAuthorityRevision,
    authorityRevision,
    changeSequence: safeInteger(value.changeSequence, 'topology change sequence', 1),
    paneChanges: Object.freeze(paneChanges),
    ...(hasRecoveryNotices
      ? {
          namespaceRecoveryNotices: parseTerminalAuthorityRecoveryNoticeProjection(
            value.namespaceRecoveryNotices
          )
        }
      : {})
  })
  assertUniqueChangeKeys(change)
  return Object.freeze({ value: change, byteLength })
}

export function parseTerminalAuthorityTopologyChange(
  value: unknown
): TerminalAuthorityTopologyChange {
  return parseTerminalAuthorityTopologyChangeWithByteLength(value).value
}

export function sameTerminalAuthorityTopologyNamespace(
  left: TerminalAuthorityNamespace,
  right: TerminalAuthorityNamespace
): boolean {
  return left.authorityHostId === right.authorityHostId && left.namespaceId === right.namespaceId
}
