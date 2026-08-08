import { createHash } from 'node:crypto'
import { assertAuthorityId } from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalSessionAuthorityMutationRequest
} from './terminal-session-authority-mutation'
import { assertSafeInteger } from './terminal-session-authority-record-validation'

const TERMINAL_AUTHORITY_OPERATION_PREFIX = 'authority-mutation:'
const TERMINAL_AUTHORITY_OPERATION_PATTERN = /^authority-mutation:\d+:[a-f0-9]{64}$/

export function terminalAuthorityOperationIdentity(
  baseRevision: number,
  correlationId: string
): Readonly<{
  operationId: string
  outcomeId: string
}> {
  assertSafeInteger(baseRevision, 'mutation base revision')
  assertAuthorityId(correlationId, 'mutation correlationId')
  if (baseRevision === Number.MAX_SAFE_INTEGER) {
    failTerminalSessionAuthority('capacity', 'authority revision is exhausted')
  }
  const digest = createHash('sha256').update(correlationId).digest('hex')
  const operationId = `${TERMINAL_AUTHORITY_OPERATION_PREFIX}${baseRevision + 1}:${digest}`
  return Object.freeze({ operationId, outcomeId: operationId })
}

export function assertTerminalAuthorityOperationIdentity(
  request: TerminalSessionAuthorityMutationRequest
): void {
  if (request.baseRevision === Number.MAX_SAFE_INTEGER) {
    failTerminalSessionAuthority('capacity', 'authority revision is exhausted')
  }
  const expectedPrefix = `${TERMINAL_AUTHORITY_OPERATION_PREFIX}${request.baseRevision + 1}:`
  if (
    !TERMINAL_AUTHORITY_OPERATION_PATTERN.test(request.operationId) ||
    !request.operationId.startsWith(expectedPrefix) ||
    request.outcomeId !== request.operationId
  ) {
    failTerminalSessionAuthority('operation-conflict', 'mutation identity is not canonical')
  }
}
