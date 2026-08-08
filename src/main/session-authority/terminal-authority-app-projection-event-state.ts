import type {
  TerminalAuthorityAppEventKey,
  TerminalAuthorityAppPaneProjection,
  TerminalAuthorityAppTopologyProjection
} from '../../shared/terminal-authority-app-projection'
import type { TerminalAuthorityDurableOutcome } from '../../shared/terminal-session-authority-mutation'

export function terminalAuthorityAppStatusProjection(
  row: TerminalAuthorityAppPaneProjection,
  event: TerminalAuthorityAppEventKey,
  now: number,
  agent = row.agent,
  topology: TerminalAuthorityAppTopologyProjection = row.topology,
  attention = row.attention
): TerminalAuthorityAppPaneProjection['status'] {
  return Object.freeze({
    event,
    pane: topology.status,
    agent: agent?.state ?? null,
    attention: attention.pendingBellCount > 0,
    updatedAt: now
  })
}

export function terminalAuthorityAppEventAlreadyProjected(
  row: TerminalAuthorityAppPaneProjection,
  event: TerminalAuthorityAppEventKey
): boolean {
  const latest = row.latestEvent
  if (!latest || latest.sequence < event.sequence) {
    return false
  }
  if (latest.sequence === event.sequence && latest.outcomeId !== event.outcomeId) {
    throw new Error('terminal authority app projection event conflicts')
  }
  return true
}

export function terminalAuthorityAppProjectionEventKey(
  consumerId: string,
  outcome: TerminalAuthorityDurableOutcome
): TerminalAuthorityAppEventKey {
  return Object.freeze({
    consumerId,
    namespace: Object.freeze({
      ...(outcome.kind === 'semantic' ? outcome.access.namespace : outcome.result.namespace)
    }),
    sequence: outcome.sequence,
    outcomeId: outcome.outcomeId
  })
}

export function sameTerminalAuthorityAppProjectionEvent(
  left: TerminalAuthorityAppEventKey | undefined,
  right: TerminalAuthorityAppEventKey
): boolean {
  return Boolean(
    left &&
    left.consumerId === right.consumerId &&
    left.namespace.authorityHostId === right.namespace.authorityHostId &&
    left.namespace.namespaceId === right.namespace.namespaceId &&
    left.sequence === right.sequence &&
    left.outcomeId === right.outcomeId
  )
}

export function latestTerminalAuthorityAppProjectionEvent(
  current: TerminalAuthorityAppEventKey | undefined,
  authority: TerminalAuthorityAppEventKey | undefined
): TerminalAuthorityAppEventKey | undefined {
  if (!current || !authority) {
    return current ?? authority
  }
  if (current.sequence === authority.sequence) {
    if (!sameTerminalAuthorityAppProjectionEvent(current, authority)) {
      throw new Error('terminal authority app projection event conflicts')
    }
    return current
  }
  return current.sequence > authority.sequence ? current : authority
}
