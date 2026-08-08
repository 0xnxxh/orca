import { isDeepStrictEqual } from 'node:util'
import type {
  TerminalAuthorityDurableOutcome,
  TerminalSessionAuthorityMutationRequest
} from './terminal-session-authority-mutation'
import type { TerminalSessionAuthorityPtyAccess } from './terminal-session-authority-pty-access'
import { terminalAuthorityOperationKey } from './terminal-session-authority-transition'

export function mutationOperationKey(outcome: TerminalAuthorityDurableOutcome): string | null {
  return outcome.kind === 'semantic'
    ? null
    : terminalAuthorityOperationKey(outcome.request.actorId, outcome.request.operationId)
}

export function mutationRequestOperationKey(
  request: TerminalSessionAuthorityMutationRequest
): string {
  return terminalAuthorityOperationKey(request.actorId, request.operationId)
}

export function semanticOutcomeOperationKey(
  outcome: TerminalAuthorityDurableOutcome
): string | null {
  return outcome.kind === 'semantic'
    ? semanticOperationKey(outcome.access, outcome.producerIncarnationId, outcome.producerSequence)
    : null
}

export function sameOperationRequest(
  left: TerminalSessionAuthorityMutationRequest,
  right: TerminalSessionAuthorityMutationRequest
): boolean {
  const { baseRevision: _leftRevision, ...leftOperation } = left
  const { baseRevision: _rightRevision, ...rightOperation } = right
  return isDeepStrictEqual(leftOperation, rightOperation)
}

export function semanticProducerKey(
  access: TerminalSessionAuthorityPtyAccess,
  producerIncarnationId: string
): string {
  return JSON.stringify([access.namespace, access.pane, access.binding, producerIncarnationId])
}

export function semanticOperationKey(
  access: TerminalSessionAuthorityPtyAccess,
  producerIncarnationId: string,
  producerSequence: number
): string {
  return JSON.stringify([semanticProducerKey(access, producerIncarnationId), producerSequence])
}
