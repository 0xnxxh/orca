import {
  assertAuthorityId,
  assertAuthorityNamespace,
  assertPaneGeneration,
  assertTerminalBinding,
  isRecord,
  type TerminalAuthorityNamespace,
  type TerminalPaneGeneration,
  type TerminalSessionBinding
} from './terminal-session-authority-identity'

export const TERMINAL_AUTHORITY_OUTCOME_DELIVERY_VERSION = 1
export const TERMINAL_AUTHORITY_OUTCOME_ACK_NOTIFICATION = 'pty.ackAuthorityOutcome'

export type TerminalAuthorityOutcomeDeliveryIdentity = Readonly<{
  version: typeof TERMINAL_AUTHORITY_OUTCOME_DELIVERY_VERSION
  namespace: TerminalAuthorityNamespace
  pane: TerminalPaneGeneration
  binding: TerminalSessionBinding
  outcomeId: string
  sequence: number
}>

export function parseTerminalAuthorityOutcomeDeliveryIdentity(
  value: unknown
): TerminalAuthorityOutcomeDeliveryIdentity | null {
  if (!isRecord(value)) {
    return null
  }
  try {
    if (value.version !== TERMINAL_AUTHORITY_OUTCOME_DELIVERY_VERSION) {
      return null
    }
    assertAuthorityNamespace(value.namespace)
    assertPaneGeneration(value.pane)
    assertTerminalBinding(value.binding)
    assertAuthorityId(value.outcomeId, 'outcomeId')
    if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1) {
      return null
    }
  } catch {
    return null
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_OUTCOME_DELIVERY_VERSION,
    namespace: Object.freeze({ ...value.namespace }),
    pane: Object.freeze({ ...value.pane }),
    binding: Object.freeze({ ...value.binding }),
    outcomeId: value.outcomeId,
    sequence: Number(value.sequence)
  })
}

export function terminalAuthorityOutcomeDeliveryKey(
  identity: TerminalAuthorityOutcomeDeliveryIdentity
): string {
  return JSON.stringify([
    identity.namespace.authorityHostId,
    identity.namespace.namespaceId,
    identity.outcomeId,
    identity.sequence
  ])
}
