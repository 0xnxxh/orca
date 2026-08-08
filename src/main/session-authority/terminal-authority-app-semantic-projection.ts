import type {
  TerminalAuthorityAppAgentProjection,
  TerminalAuthorityAppCommandCodeProjection,
  TerminalAuthorityAppEventKey,
  TerminalAuthorityAppFactProjection,
  TerminalAuthorityAppPaneProjection
} from '../../shared/terminal-authority-app-projection'
import {
  sameTerminalBinding,
  type TerminalSessionBinding
} from '../../shared/terminal-session-authority-identity'
import type {
  TerminalAuthorityDurableOutcome,
  TerminalSessionAuthoritySemanticFact
} from '../../shared/terminal-session-authority-mutation'
import {
  sameTerminalAuthorityAppProjectionEvent,
  terminalAuthorityAppEventAlreadyProjected,
  terminalAuthorityAppProjectionEventKey,
  terminalAuthorityAppStatusProjection
} from './terminal-authority-app-projection-event-state'
import type { TerminalAuthorityAppProjectionRowLookup } from './terminal-authority-app-projection-reducer'

export const TERMINAL_AUTHORITY_PR_VERIFY_DELAY_MS = 30_000
export const TERMINAL_AUTHORITY_COMMAND_CODE_SETTLE_MS = 1_500
const MAX_PENDING_BELLS = 99

export function reduceTerminalAuthorityAppSemanticProjection(
  consumerId: string,
  outcome: Extract<TerminalAuthorityDurableOutcome, { kind: 'semantic' }>,
  lookup: TerminalAuthorityAppProjectionRowLookup,
  now: number
): readonly TerminalAuthorityAppPaneProjection[] {
  const current = lookup(consumerId, outcome, outcome.access.pane)
  if (!current) {
    throw new Error('terminal authority app projection requires an authoritative pane snapshot')
  }
  const event = terminalAuthorityAppProjectionEventKey(consumerId, outcome)
  if (terminalAuthorityAppEventAlreadyProjected(current, event)) {
    return Object.freeze([])
  }
  const binding = current.binding ?? current.topology.lastBinding
  if (!binding || !sameTerminalBinding(binding, outcome.access.binding)) {
    throw new Error('terminal authority app projection fact binding is stale')
  }
  const fact = projectFact(event, outcome.access.binding, outcome.fact, now)
  const facts = Object.freeze({ ...current.facts, [outcome.fact.kind]: fact })
  const attention = projectAttention(current, event, outcome.fact, now)
  const agent = projectAgent(current.agent, event, outcome.access.binding, outcome.fact, now)
  const commandCode = projectCommandCode(
    current.commandCode,
    event,
    outcome.access.binding,
    outcome.fact,
    now
  )
  return Object.freeze([
    Object.freeze({
      ...current,
      latestEvent: event,
      facts,
      attention,
      ...(agent ? { agent } : {}),
      ...(commandCode ? { commandCode } : {}),
      status: terminalAuthorityAppStatusProjection(
        current,
        event,
        now,
        agent,
        current.topology,
        attention
      )
    })
  ])
}

export function settleTerminalAuthorityCommandCodeProjection(
  row: TerminalAuthorityAppPaneProjection,
  now: number
): TerminalAuthorityAppPaneProjection | null {
  const current = row.commandCode
  if (
    !current ||
    current.state !== 'settling' ||
    current.settleAt === null ||
    current.settleAt > now
  ) {
    return null
  }
  const commandCode = Object.freeze({
    ...current,
    state: 'done' as const,
    transitionedAt: current.settleAt,
    settleAt: null
  })
  const agent = sameTerminalAuthorityAppProjectionEvent(row.agent?.event, current.event)
    ? Object.freeze({ ...row.agent!, state: 'done' as const, transitionedAt: current.settleAt })
    : row.agent
  return Object.freeze({
    ...row,
    commandCode,
    ...(agent ? { agent } : {}),
    status: terminalAuthorityAppStatusProjection(
      row,
      current.event,
      now,
      agent,
      row.topology,
      row.attention
    )
  })
}

export function settleTerminalAuthorityCommandCodeProjections(
  rows: readonly TerminalAuthorityAppPaneProjection[],
  now: number
): readonly TerminalAuthorityAppPaneProjection[] {
  return rows
    .map((row) => settleTerminalAuthorityCommandCodeProjection(row, now))
    .filter((row): row is TerminalAuthorityAppPaneProjection => row !== null)
}

export function terminalAuthorityAppPrVerificationsDue(
  rows: readonly TerminalAuthorityAppPaneProjection[],
  now: number
): readonly TerminalAuthorityAppPaneProjection[] {
  return rows.filter((row) => {
    const field = row.facts['pr-link']
    return field?.verification === 'pending' && (field.verifyAfter ?? Infinity) <= now
  })
}

function projectFact(
  event: TerminalAuthorityAppEventKey,
  binding: TerminalSessionBinding,
  fact: TerminalSessionAuthoritySemanticFact,
  now: number
): TerminalAuthorityAppFactProjection {
  return Object.freeze({
    event,
    binding: Object.freeze({ ...binding }),
    fact: structuredClone(fact),
    appliedAt: now,
    ...(fact.kind === 'pr-link'
      ? {
          verifyAfter: now + TERMINAL_AUTHORITY_PR_VERIFY_DELAY_MS,
          verification: 'pending' as const
        }
      : {})
  })
}

function projectAttention(
  row: TerminalAuthorityAppPaneProjection,
  event: TerminalAuthorityAppEventKey,
  fact: TerminalSessionAuthoritySemanticFact,
  now: number
): TerminalAuthorityAppPaneProjection['attention'] {
  if (fact.kind !== 'bell') {
    return row.attention
  }
  return Object.freeze({
    event,
    pendingBellCount: Math.min(row.attention.pendingBellCount + 1, MAX_PENDING_BELLS),
    updatedAt: now
  })
}

function projectAgent(
  current: TerminalAuthorityAppAgentProjection | undefined,
  event: TerminalAuthorityAppEventKey,
  binding: TerminalSessionBinding,
  fact: TerminalSessionAuthoritySemanticFact,
  now: number
): TerminalAuthorityAppAgentProjection | undefined {
  const state = agentState(fact)
  if (!state) {
    return current
  }
  const prompt =
    fact.kind === 'agent-status'
      ? fact.payload.prompt
      : fact.kind === 'command-code-working' || fact.kind === 'command-code-done'
        ? fact.prompt.trim()
        : (current?.prompt ?? '')
  return Object.freeze({
    event,
    binding: Object.freeze({ ...binding }),
    state,
    prompt,
    transitionedAt: now
  })
}

function projectCommandCode(
  current: TerminalAuthorityAppCommandCodeProjection | undefined,
  event: TerminalAuthorityAppEventKey,
  binding: TerminalSessionBinding,
  fact: TerminalSessionAuthoritySemanticFact,
  now: number
): TerminalAuthorityAppCommandCodeProjection | undefined {
  if (fact.kind === 'command-code-working') {
    return Object.freeze({
      event,
      binding: Object.freeze({ ...binding }),
      state: 'working',
      prompt: fact.prompt.trim(),
      transitionedAt: now,
      settleAt: null
    })
  }
  if (fact.kind !== 'command-code-done') {
    return current
  }
  return Object.freeze({
    event,
    binding: Object.freeze({ ...binding }),
    state: 'settling',
    prompt: fact.prompt.trim(),
    transitionedAt: now,
    settleAt: now + TERMINAL_AUTHORITY_COMMAND_CODE_SETTLE_MS
  })
}

function agentState(
  fact: TerminalSessionAuthoritySemanticFact
): TerminalAuthorityAppAgentProjection['state'] | null {
  switch (fact.kind) {
    case 'agent-status':
      return fact.payload.state
    case 'agent-working':
    case 'command-code-working':
      return 'working'
    case 'agent-idle':
      return 'idle'
    case 'agent-exited':
      return 'exited'
    case 'command-code-done':
      return 'working'
    case 'title':
    case 'bell':
    case 'command-finished':
    case 'pr-link':
    case '2031-subscribe':
    case '2031-unsubscribe':
      return null
  }
}
