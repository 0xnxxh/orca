import { PTY_EXACT_OPERATION_PROTOCOL_VERSION } from '../shared/pty-exact-operation-protocol'
import { TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION } from '../shared/terminal-authority-exact-operation-protocol'

export function requestsExactOperations(params: Record<string, unknown>): boolean {
  return offersVersion(params.capabilities, 'exactOperations', PTY_EXACT_OPERATION_PROTOCOL_VERSION)
}

export function grantsExactOperations(value: unknown): boolean {
  return grantsVersion(value, 'exactOperations', PTY_EXACT_OPERATION_PROTOCOL_VERSION)
}

export function requestsTerminalAuthorityExactOperations(params: Record<string, unknown>): boolean {
  return offersVersion(
    params.capabilities,
    'terminalAuthorityExactOperations',
    TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION
  )
}

export function grantsTerminalAuthorityExactOperations(value: unknown): boolean {
  return grantsVersion(
    value,
    'terminalAuthorityExactOperations',
    TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION
  )
}

function offersVersion(value: unknown, key: string, version: number): boolean {
  const capability = recordValue(recordValue(value, key), 'versions')
  return Array.isArray(capability) && capability.includes(version)
}

function grantsVersion(value: unknown, key: string, version: number): boolean {
  const capabilities = recordValue(value, 'capabilities')
  const capability = recordValue(capabilities, key)
  return recordValue(capability, 'version') === version
}

function recordValue(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined
}
