import {
  assertAuthorityNamespace,
  isRecord,
  type TerminalAuthorityNamespace
} from './terminal-session-authority-identity'
import type {
  TerminalAuthorityDurableOutcome,
  TerminalAuthorityProjection
} from './terminal-session-authority-mutation'
import { parseTerminalAuthorityDurableOutcome } from './terminal-authority-durable-outcome-validation'
import {
  assertAllocationRecord,
  assertPaneRecord,
  assertSafeInteger
} from './terminal-session-authority-record-validation'

const MAX_MATERIALIZED_BOUNDARY_OUTCOMES = 16_384

export function parseTerminalAuthorityBoundaryProjection(
  value: unknown,
  boundaryNamespace: TerminalAuthorityNamespace,
  outcomeHighWatermark: number
): TerminalAuthorityProjection | null {
  if (!isRecord(value) || !Array.isArray(value.panes) || !Array.isArray(value.allocations)) {
    return null
  }
  const materializedOutcomes =
    value.materializedOutcomes === undefined
      ? undefined
      : parseMaterializedOutcomes(
          value.materializedOutcomes,
          boundaryNamespace,
          outcomeHighWatermark
        )
  try {
    assertAuthorityNamespace(value.namespace)
    assertSafeInteger(value.writerEpoch, 'projection writer epoch', 1)
    assertSafeInteger(value.revision, 'projection revision')
    value.panes.forEach(assertPaneRecord)
    value.allocations.forEach(assertAllocationRecord)
  } catch {
    return null
  }
  if (
    !sameTerminalAuthorityOutcomeNamespace(value.namespace, boundaryNamespace) ||
    (value.materializedOutcomes !== undefined && !materializedOutcomes)
  ) {
    return null
  }
  return Object.freeze(structuredClone(value)) as TerminalAuthorityProjection
}

export function sameTerminalAuthorityOutcomeNamespace(
  left: TerminalAuthorityNamespace,
  right: TerminalAuthorityNamespace
): boolean {
  return left.authorityHostId === right.authorityHostId && left.namespaceId === right.namespaceId
}

export function terminalAuthorityOutcomeMatchesNamespace(
  outcome: TerminalAuthorityDurableOutcome,
  namespace: TerminalAuthorityNamespace
): boolean {
  const actual = outcome.kind === 'semantic' ? outcome.access.namespace : outcome.result.namespace
  return sameTerminalAuthorityOutcomeNamespace(actual, namespace)
}

function parseMaterializedOutcomes(
  value: unknown,
  namespace: TerminalAuthorityNamespace,
  outcomeHighWatermark: number
): readonly TerminalAuthorityDurableOutcome[] | null {
  if (!Array.isArray(value) || value.length > MAX_MATERIALIZED_BOUNDARY_OUTCOMES) {
    return null
  }
  const outcomes = value.map(parseTerminalAuthorityDurableOutcome)
  if (outcomes.some((outcome) => !outcome)) {
    return null
  }
  let previousSequence = 0
  for (const outcome of outcomes as TerminalAuthorityDurableOutcome[]) {
    if (
      outcome.sequence <= previousSequence ||
      outcome.sequence > outcomeHighWatermark ||
      !terminalAuthorityOutcomeMatchesNamespace(outcome, namespace)
    ) {
      return null
    }
    previousSequence = outcome.sequence
  }
  return Object.freeze(outcomes as TerminalAuthorityDurableOutcome[])
}
