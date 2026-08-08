import type { TerminalAuthorityAppEventKey } from './terminal-authority-app-projection'
import {
  assertAuthorityId,
  assertAuthorityNamespace,
  isRecord
} from './terminal-session-authority-identity'

export function parseTerminalAuthorityAppEventKey(
  value: unknown
): TerminalAuthorityAppEventKey | null {
  if (
    !isRecord(value) ||
    !isAuthorityId(value.consumerId) ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    !isAuthorityId(value.outcomeId)
  ) {
    return null
  }
  try {
    assertAuthorityNamespace(value.namespace)
    return Object.freeze({
      consumerId: value.consumerId,
      namespace: Object.freeze({ ...value.namespace }),
      sequence: Number(value.sequence),
      outcomeId: value.outcomeId
    })
  } catch {
    return null
  }
}

export function assertTerminalAuthorityAppMatchingEvent(
  value: unknown,
  row: Record<string, unknown>
): TerminalAuthorityAppEventKey {
  const event = parseTerminalAuthorityAppEventKey(value)
  if (
    !event ||
    event.consumerId !== row.consumerId ||
    !sameTerminalAuthorityAppProjectionNamespace(event.namespace, row.namespace as never)
  ) {
    throw new Error('terminal authority app projection event identity changed')
  }
  return event
}

export function sameTerminalAuthorityAppProjectionNamespace(
  left: { authorityHostId: string; namespaceId: string },
  right: { authorityHostId: string; namespaceId: string }
): boolean {
  return left.authorityHostId === right.authorityHostId && left.namespaceId === right.namespaceId
}

function isAuthorityId(value: unknown): value is string {
  try {
    assertAuthorityId(value, 'authority projection ID')
    return true
  } catch {
    return false
  }
}
