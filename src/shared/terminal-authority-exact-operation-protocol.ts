import { assertAuthorityId, isRecord } from './terminal-session-authority-identity'
import {
  parseTerminalSessionAuthorityPtyAccess,
  type TerminalSessionAuthorityPtyAccess
} from './terminal-session-authority-pty-access'

export const TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION = 1

export const PTY_DATA_AUTHORITY_EXACT_METHOD = 'pty.dataAuthorityExact'
export const PTY_RESIZE_AUTHORITY_EXACT_METHOD = 'pty.resizeAuthorityExact'
export const PTY_SEND_SIGNAL_AUTHORITY_EXACT_METHOD = 'pty.sendSignalAuthorityExact'
export const PTY_CLEAR_BUFFER_AUTHORITY_EXACT_METHOD = 'pty.clearBufferAuthorityExact'
export const PTY_SHUTDOWN_AUTHORITY_EXACT_METHOD = 'pty.shutdownAuthorityExact'

export type PtyAuthorityExactOperationMethod =
  | typeof PTY_DATA_AUTHORITY_EXACT_METHOD
  | typeof PTY_RESIZE_AUTHORITY_EXACT_METHOD
  | typeof PTY_SEND_SIGNAL_AUTHORITY_EXACT_METHOD
  | typeof PTY_CLEAR_BUFFER_AUTHORITY_EXACT_METHOD
  | typeof PTY_SHUTDOWN_AUTHORITY_EXACT_METHOD

export type PtyAuthorityExactMutation =
  | Readonly<{ kind: 'data'; data: string }>
  | Readonly<{ kind: 'resize'; cols: number; rows: number }>
  | Readonly<{ kind: 'signal'; signal: string }>
  | Readonly<{ kind: 'clear' }>
  | Readonly<{ kind: 'shutdown'; immediate: boolean; keepHistory: boolean }>

export type PtyAuthorityExactOperationRequest = Readonly<{
  id: string
  terminalSessionAuthorityAccess: TerminalSessionAuthorityPtyAccess
  mutation: PtyAuthorityExactMutation
}>

export function parsePtyAuthorityExactOperationRequest(
  method: PtyAuthorityExactOperationMethod,
  value: Record<string, unknown>
): PtyAuthorityExactOperationRequest {
  assertAuthorityId(value.id, 'authority exact PTY id')
  const access = parseTerminalSessionAuthorityPtyAccess(value.terminalSessionAuthorityAccess)
  if (
    !access ||
    !isRecord(value.terminalSessionAuthorityAccess) ||
    access.binding.physicalPtyId !== value.id
  ) {
    throw new Error('authority exact PTY access is invalid')
  }
  return Object.freeze({
    id: value.id,
    terminalSessionAuthorityAccess: access,
    mutation: parseMutation(method, value)
  })
}

function parseMutation(
  method: PtyAuthorityExactOperationMethod,
  value: Record<string, unknown>
): PtyAuthorityExactMutation {
  if (method === PTY_DATA_AUTHORITY_EXACT_METHOD) {
    if (typeof value.data !== 'string') {
      throw new Error('authority exact PTY data is invalid')
    }
    return Object.freeze({ kind: 'data', data: value.data })
  }
  if (method === PTY_RESIZE_AUTHORITY_EXACT_METHOD) {
    if (
      typeof value.cols !== 'number' ||
      !Number.isFinite(value.cols) ||
      typeof value.rows !== 'number' ||
      !Number.isFinite(value.rows)
    ) {
      throw new Error('authority exact PTY size is invalid')
    }
    return Object.freeze({ kind: 'resize', cols: value.cols, rows: value.rows })
  }
  if (method === PTY_SEND_SIGNAL_AUTHORITY_EXACT_METHOD) {
    if (typeof value.signal !== 'string' || value.signal.length === 0) {
      throw new Error('authority exact PTY signal is invalid')
    }
    return Object.freeze({ kind: 'signal', signal: value.signal })
  }
  if (method === PTY_CLEAR_BUFFER_AUTHORITY_EXACT_METHOD) {
    return Object.freeze({ kind: 'clear' })
  }
  if (typeof value.immediate !== 'boolean' || typeof value.keepHistory !== 'boolean') {
    throw new Error('authority exact PTY shutdown request is invalid')
  }
  return Object.freeze({
    kind: 'shutdown',
    immediate: value.immediate,
    keepHistory: value.keepHistory
  })
}
