import { isPtyIncarnationId, type PtyIncarnationId } from './pty-incarnation'

export const PTY_EXACT_OPERATION_PROTOCOL_VERSION = 1

export function matchesPtyExactOperationIdentity(
  currentIncarnationId: string | undefined,
  expectedIncarnationId: unknown
): expectedIncarnationId is PtyIncarnationId {
  return isPtyIncarnationId(expectedIncarnationId) && currentIncarnationId === expectedIncarnationId
}
