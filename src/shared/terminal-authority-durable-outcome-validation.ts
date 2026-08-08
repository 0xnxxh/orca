import {
  assertAuthorityNamespace,
  isRecord,
  type TerminalAuthorityNamespace
} from './terminal-session-authority-identity'
import type { TerminalAuthorityDurableOutcome } from './terminal-session-authority-mutation'
import { validateRestoredOutcome } from './terminal-session-authority-restore-validation'

export function parseTerminalAuthorityDurableOutcome(
  value: unknown
): TerminalAuthorityDurableOutcome | null {
  if (!isRecord(value) || (value.kind !== undefined && value.kind !== 'semantic')) {
    return null
  }
  try {
    const namespace = outcomeNamespaceFromUnknown(value)
    const revision =
      value.kind === 'semantic'
        ? Number(value.appendedAtRevision)
        : Number((value.result as Record<string, unknown>).revision)
    validateRestoredOutcome(value as TerminalAuthorityDurableOutcome, namespace, revision)
    return Object.freeze(structuredClone(value)) as TerminalAuthorityDurableOutcome
  } catch {
    return null
  }
}

export function terminalAuthorityDurableOutcomeNamespace(
  outcome: TerminalAuthorityDurableOutcome
): TerminalAuthorityNamespace {
  return outcome.kind === 'semantic' ? outcome.access.namespace : outcome.result.namespace
}

function outcomeNamespaceFromUnknown(value: Record<string, unknown>): TerminalAuthorityNamespace {
  const container = value.kind === 'semantic' ? value.access : value.result
  if (!isRecord(container)) {
    throw new Error('authority outcome namespace is invalid')
  }
  assertAuthorityNamespace(container.namespace)
  return container.namespace
}
