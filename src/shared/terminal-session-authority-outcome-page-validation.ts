import { isDeepStrictEqual } from 'node:util'
import type { TerminalAuthorityNamespace } from './terminal-session-authority-identity'
import type { TerminalAuthorityDurableOutcome } from './terminal-session-authority-mutation'
import { parseTerminalAuthorityDurableOutcome } from './terminal-authority-durable-outcome-validation'
import { terminalAuthorityOutcomeMatchesNamespace } from './terminal-session-authority-boundary-projection-validation'

const MAX_TERMINAL_AUTHORITY_OUTCOME_PAGE_SIZE = 64

export function parseTerminalAuthorityOutcomePage(
  value: unknown,
  first: TerminalAuthorityDurableOutcome,
  namespace: TerminalAuthorityNamespace
): readonly TerminalAuthorityDurableOutcome[] | null {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_TERMINAL_AUTHORITY_OUTCOME_PAGE_SIZE
  ) {
    return null
  }
  const outcomes = value.map(parseTerminalAuthorityDurableOutcome)
  if (outcomes.some((outcome) => !outcome)) {
    return null
  }
  const parsed = outcomes as TerminalAuthorityDurableOutcome[]
  if (!isDeepStrictEqual(parsed[0], first)) {
    return null
  }
  for (let index = 0; index < parsed.length; index += 1) {
    const outcome = parsed[index]!
    if (
      outcome.sequence !== first.sequence + index ||
      !terminalAuthorityOutcomeMatchesNamespace(outcome, namespace)
    ) {
      return null
    }
  }
  return Object.freeze(parsed)
}
