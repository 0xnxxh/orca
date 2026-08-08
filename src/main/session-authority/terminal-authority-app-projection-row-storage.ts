import {
  terminalAuthorityAppProjectionRowKey,
  type TerminalAuthorityAppPaneProjection
} from '../../shared/terminal-authority-app-projection'
import {
  assertTerminalAuthorityAppPaneProjection,
  parseTerminalAuthorityAppPaneProjection
} from '../../shared/terminal-authority-app-projection-validation'

export const TERMINAL_AUTHORITY_APP_PROJECTION_MAX_ROW_BYTES = 64 * 1024

export type TerminalAuthorityAppProjectionDatabaseRow = {
  consumer_id: string
  authority_host_id: string
  namespace_id: string
  pane_key: string
  pane_generation_id: string
  projection_json: string
}

export function parseTerminalAuthorityAppProjectionDatabaseRow(
  row: TerminalAuthorityAppProjectionDatabaseRow
): TerminalAuthorityAppPaneProjection {
  if (
    Buffer.byteLength(row.projection_json, 'utf8') > TERMINAL_AUTHORITY_APP_PROJECTION_MAX_ROW_BYTES
  ) {
    throw new Error('terminal authority app projection row capacity exceeded')
  }
  let value: unknown
  try {
    value = JSON.parse(row.projection_json)
  } catch {
    throw new Error('terminal authority app projection row is corrupt')
  }
  const projection = parseTerminalAuthorityAppPaneProjection(value)
  if (!projection || terminalAuthorityAppProjectionRowKey(projection) !== databaseRowKey(row)) {
    throw new Error('terminal authority app projection row identity changed')
  }
  return projection
}

export function serializeTerminalAuthorityAppProjectionRow(
  row: TerminalAuthorityAppPaneProjection
): string {
  assertTerminalAuthorityAppPaneProjection(row)
  const contents = JSON.stringify(row)
  if (Buffer.byteLength(contents, 'utf8') > TERMINAL_AUTHORITY_APP_PROJECTION_MAX_ROW_BYTES) {
    throw new Error('terminal authority app projection row capacity exceeded')
  }
  return contents
}

function databaseRowKey(row: TerminalAuthorityAppProjectionDatabaseRow): string {
  return JSON.stringify([
    row.consumer_id,
    row.authority_host_id,
    row.namespace_id,
    row.pane_key,
    row.pane_generation_id
  ])
}
