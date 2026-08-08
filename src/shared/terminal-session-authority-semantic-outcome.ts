import { createHash } from 'node:crypto'
import {
  assertAuthorityId,
  sameTerminalBinding,
  type TerminalSessionBinding
} from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalAuthoritySemanticOutcome,
  type TerminalSessionAuthoritySemanticOutcomeRequest
} from './terminal-session-authority-mutation'
import type { TerminalSessionAuthorityOutcomeJournal } from './terminal-session-authority-outcome-journal'
import {
  assertSafeInteger,
  assertSemanticFact,
  terminalAuthorityOutcomeByteLength
} from './terminal-session-authority-record-validation'
import { assertSemanticallyEqual } from './terminal-session-authority-semantic-equality'
import type { TerminalAuthorityTransitionView } from './terminal-session-authority-transition'

const TERMINAL_AUTHORITY_SEMANTIC_PREFIX = 'authority-outcome:'

/**
 * Producer incarnation fences a counter that restarts at 1, so a worker restart
 * or an adopted foreign binding can never collide with a durable outcome ID.
 */
export function terminalAuthoritySemanticOutcomeId(
  binding: TerminalSessionBinding,
  producerIncarnationId: string,
  producerSequence: number
): string {
  assertAuthorityId(producerIncarnationId, 'producerIncarnationId')
  assertSafeInteger(producerSequence, 'outcome producer sequence', 1)
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        binding.ownerIncarnationId,
        binding.physicalPtyId,
        binding.ptyIncarnationId,
        producerIncarnationId
      ])
    )
    .digest('hex')
  return `${TERMINAL_AUTHORITY_SEMANTIC_PREFIX}${producerSequence}:${digest}`
}

/** A retry resolves by durable outcome ID first, so a since-retired binding still returns its result. */
export function planTerminalAuthoritySemanticOutcome(
  view: TerminalAuthorityTransitionView,
  journal: TerminalSessionAuthorityOutcomeJournal,
  request: TerminalSessionAuthoritySemanticOutcomeRequest
): { outcome: TerminalAuthoritySemanticOutcome; duplicate: boolean } {
  const outcomeId = terminalAuthoritySemanticOutcomeId(
    request.access.binding,
    request.producerIncarnationId,
    request.producerSequence
  )
  const existing = journal.findSemantic(request)
  if (existing) {
    assertSemanticallyEqual(
      {
        access: existing.access,
        producerIncarnationId: existing.producerIncarnationId,
        producerSequence: existing.producerSequence,
        fact: existing.fact
      },
      request,
      'semantic outcome retry changed its request'
    )
    return { outcome: existing, duplicate: true }
  }
  const outcome = deriveSemanticOutcome(view, request, outcomeId, journal.nextSequence(outcomeId))
  journal.assertCanAppend(outcome)
  return { outcome, duplicate: false }
}

export function applyTerminalAuthoritySemanticRecord(
  view: TerminalAuthorityTransitionView,
  journal: TerminalSessionAuthorityOutcomeJournal,
  outcome: TerminalAuthoritySemanticOutcome
): void {
  const replanned = planTerminalAuthoritySemanticOutcome(view, journal, {
    access: outcome.access,
    producerIncarnationId: outcome.producerIncarnationId,
    producerSequence: outcome.producerSequence,
    fact: outcome.fact
  })
  if (replanned.duplicate) {
    failTerminalSessionAuthority('record-corrupt', 'semantic record repeats a durable outcome')
  }
  assertSemanticallyEqual(replanned.outcome, outcome, 'semantic outcome is not canonical')
  journal.applyOutcome(outcome)
}

/**
 * Semantic facts never move topology, so they carry the current revision rather
 * than minting one; the exact binding is the fence.
 */
function deriveSemanticOutcome(
  view: TerminalAuthorityTransitionView,
  request: TerminalSessionAuthoritySemanticOutcomeRequest,
  outcomeId: string,
  sequence: number
): TerminalAuthoritySemanticOutcome {
  assertSemanticFact(request.fact)
  const access = request.access
  if (
    access.namespace.authorityHostId !== view.namespace.authorityHostId ||
    access.namespace.namespaceId !== view.namespace.namespaceId
  ) {
    failTerminalSessionAuthority('record-corrupt', 'semantic outcome names another namespace')
  }
  const pane = view.pane(access.pane)
  if (pane?.status !== 'open' || !sameTerminalBinding(pane.binding, access.binding)) {
    failTerminalSessionAuthority(
      'expectation-mismatch',
      'semantic outcome names a stale pane generation or PTY incarnation'
    )
  }
  const base = {
    kind: 'semantic' as const,
    sequence,
    outcomeId,
    access: Object.freeze({
      namespace: Object.freeze({ ...access.namespace }),
      pane: Object.freeze({ ...access.pane }),
      binding: Object.freeze({ ...access.binding })
    }),
    producerIncarnationId: request.producerIncarnationId,
    producerSequence: request.producerSequence,
    fact: Object.freeze(structuredClone(request.fact)),
    appendedAtRevision: view.revision
  }
  return Object.freeze({ ...base, byteLength: terminalAuthorityOutcomeByteLength(base) })
}
