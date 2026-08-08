import {
  TERMINAL_AUTHORITY_APP_PROJECTION_MAX_ROWS,
  TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
  terminalAuthorityAppProjectionRowKey,
  type TerminalAuthorityAppBellClearRequest,
  type TerminalAuthorityAppPaneProjection,
  type TerminalAuthorityAppProjectionDelta,
  type TerminalAuthorityAppProjectionRowIdentity,
  type TerminalAuthorityAppProjectionSnapshot,
  type TerminalAuthorityAppProjectionSubscribe
} from './terminal-authority-app-projection'
import {
  assertAuthorityId,
  assertAuthorityNamespace,
  assertPaneGeneration,
  isRecord
} from './terminal-session-authority-identity'
import { assertTerminalAuthorityAppPaneProjection } from './terminal-authority-app-projection-row-validation'
import {
  parseTerminalAuthorityAppEventKey,
  sameTerminalAuthorityAppProjectionNamespace
} from './terminal-authority-app-projection-event-validation'

export { assertTerminalAuthorityAppPaneProjection } from './terminal-authority-app-projection-row-validation'

export function parseTerminalAuthorityAppProjectionSubscribe(
  value: unknown
): TerminalAuthorityAppProjectionSubscribe | null {
  if (!isVersionedRecord(value) || !isAuthorityId(value.subscriptionIncarnationId)) {
    return null
  }
  const expected = value.expectedSubscriptionIncarnationId
  if (expected !== undefined && expected !== null && !isAuthorityId(expected)) {
    return null
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
    subscriptionIncarnationId: value.subscriptionIncarnationId,
    ...(expected !== undefined ? { expectedSubscriptionIncarnationId: expected } : {})
  })
}

export function parseTerminalAuthorityAppProjectionSnapshot(
  value: unknown
): TerminalAuthorityAppProjectionSnapshot | null {
  return parseProjectionEnvelope(value, false)
}

export function parseTerminalAuthorityAppProjectionDelta(
  value: unknown
): TerminalAuthorityAppProjectionDelta | null {
  return parseProjectionEnvelope(value, true)
}

export function parseTerminalAuthorityAppBellClearRequest(
  value: unknown
): TerminalAuthorityAppBellClearRequest | null {
  if (!isVersionedRecord(value) || !isAuthorityId(value.consumerId)) {
    return null
  }
  try {
    assertAuthorityNamespace(value.namespace)
    assertPaneGeneration(value.pane)
  } catch {
    return null
  }
  const expectedEvent = parseTerminalAuthorityAppEventKey(value.expectedEvent)
  if (
    !expectedEvent ||
    expectedEvent.consumerId !== value.consumerId ||
    !sameTerminalAuthorityAppProjectionNamespace(expectedEvent.namespace, value.namespace)
  ) {
    return null
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
    consumerId: value.consumerId,
    namespace: Object.freeze({ ...value.namespace }),
    pane: Object.freeze({ ...value.pane }),
    expectedEvent
  })
}

export function parseTerminalAuthorityAppPaneProjection(
  value: unknown
): TerminalAuthorityAppPaneProjection | null {
  try {
    assertTerminalAuthorityAppPaneProjection(value)
    return Object.freeze(structuredClone(value))
  } catch {
    return null
  }
}

function parseProjectionEnvelope(
  value: unknown,
  allowDeleted: boolean
): TerminalAuthorityAppProjectionSnapshot | null {
  if (
    !isVersionedRecord(value) ||
    !isAuthorityId(value.subscriptionIncarnationId) ||
    !Array.isArray(value.rows) ||
    value.rows.length > TERMINAL_AUTHORITY_APP_PROJECTION_MAX_ROWS
  ) {
    return null
  }
  const rows = value.rows.map(parseTerminalAuthorityAppPaneProjection)
  if (rows.some((row) => row === null)) {
    return null
  }
  const parsedRows = rows as TerminalAuthorityAppPaneProjection[]
  const rowKeys = new Set(parsedRows.map(terminalAuthorityAppProjectionRowKey))
  if (rowKeys.size !== parsedRows.length) {
    return null
  }
  const deleted = allowDeleted ? parseDeleted(value.deleted, rowKeys) : null
  if (allowDeleted && value.deleted !== undefined && !deleted) {
    return null
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
    subscriptionIncarnationId: value.subscriptionIncarnationId,
    rows: Object.freeze(parsedRows),
    ...(deleted ? { deleted } : {})
  })
}

function parseDeleted(
  value: unknown,
  rowKeys: ReadonlySet<string>
): readonly TerminalAuthorityAppProjectionRowIdentity[] | null {
  if (value === undefined) {
    return null
  }
  if (!Array.isArray(value) || value.length > TERMINAL_AUTHORITY_APP_PROJECTION_MAX_ROWS) {
    return null
  }
  const parsed = value.map(parseRowIdentity)
  if (parsed.some((row) => row === null)) {
    return null
  }
  const rows = parsed as TerminalAuthorityAppProjectionRowIdentity[]
  const keys = rows.map(terminalAuthorityAppProjectionRowKey)
  if (new Set(keys).size !== keys.length || keys.some((key) => rowKeys.has(key))) {
    return null
  }
  return Object.freeze(rows)
}

function parseRowIdentity(value: unknown): TerminalAuthorityAppProjectionRowIdentity | null {
  if (!isRecord(value) || !isAuthorityId(value.consumerId)) {
    return null
  }
  try {
    assertAuthorityNamespace(value.namespace)
    assertPaneGeneration(value.pane)
    return Object.freeze({
      consumerId: value.consumerId,
      namespace: Object.freeze({ ...value.namespace }),
      pane: Object.freeze({ ...value.pane })
    })
  } catch {
    return null
  }
}

function isVersionedRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.version === TERMINAL_AUTHORITY_APP_PROJECTION_VERSION
}

function isAuthorityId(value: unknown): value is string {
  try {
    assertAuthorityId(value, 'authority projection ID')
    return true
  } catch {
    return false
  }
}
