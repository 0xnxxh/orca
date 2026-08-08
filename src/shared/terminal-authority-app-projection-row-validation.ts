import { AGENT_STATUS_STATES } from './agent-status-types'
import {
  TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
  type TerminalAuthorityAppEventKey,
  type TerminalAuthorityAppPaneProjection
} from './terminal-authority-app-projection'
import {
  assertAuthorityId,
  assertAuthorityNamespace,
  assertPaneGeneration,
  assertTerminalBinding,
  isRecord,
  sameTerminalBinding
} from './terminal-session-authority-identity'
import {
  assertAllocationRecord,
  assertPaneRecord,
  assertSafeInteger,
  assertSemanticFact
} from './terminal-session-authority-record-validation'
import { parsePaneKey } from './stable-pane-id'
import { assertTerminalAuthorityAppMatchingEvent } from './terminal-authority-app-projection-event-validation'

const FACT_KINDS = new Set([
  'agent-status',
  'title',
  'bell',
  'agent-working',
  'agent-idle',
  'agent-exited',
  'command-finished',
  'pr-link',
  'command-code-working',
  'command-code-done',
  '2031-subscribe',
  '2031-unsubscribe'
])
const AGENT_STATES = new Set([...AGENT_STATUS_STATES, 'idle', 'exited'])

export function assertTerminalAuthorityAppPaneProjection(
  value: unknown
): asserts value is TerminalAuthorityAppPaneProjection {
  if (!isVersionedRecord(value) || !isAuthorityId(value.consumerId) || !isRecord(value.facts)) {
    throw new Error('terminal authority app projection row is invalid')
  }
  assertAuthorityNamespace(value.namespace)
  assertPaneGeneration(value.pane)
  assertLayout(value.layout, value.pane.paneKey)
  if (value.binding !== null) {
    assertTerminalBinding(value.binding)
  }
  assertTopology(value)
  if (!sameNullableBinding(value.binding, value.topology.binding)) {
    throw new Error('terminal authority app projection binding changed')
  }
  if (value.allocation !== undefined) {
    assertAllocationRecord(value.allocation)
    if (!samePane(value.allocation.pane, value.pane)) {
      throw new Error('terminal authority app projection allocation changed pane')
    }
  }
  const events = assertFacts(value)
  assertDerivedProjection(value, events)
}

function assertTopology(
  value: Record<string, unknown>
): asserts value is Record<string, unknown> & { topology: Record<string, unknown> } {
  if (!isRecord(value.topology)) {
    throw new Error('terminal authority app projection topology is invalid')
  }
  const pane = value.pane
  if (!isRecord(pane)) {
    throw new Error('terminal authority app projection pane is invalid')
  }
  assertPaneRecord({ ...pane, ...value.topology, revision: value.topology.authorityRevision })
  if (
    value.topology.ownerStatus !== null &&
    value.topology.ownerStatus !== 'reachable' &&
    value.topology.ownerStatus !== 'owner-unreachable'
  ) {
    throw new Error('terminal authority app projection owner status is invalid')
  }
  if (value.topology.event !== undefined) {
    assertTerminalAuthorityAppMatchingEvent(value.topology.event, value)
  }
}

function assertFacts(value: Record<string, unknown>): TerminalAuthorityAppEventKey[] {
  const facts = value.facts as Record<string, unknown>
  const events: TerminalAuthorityAppEventKey[] = []
  for (const [kind, field] of Object.entries(facts)) {
    if (!FACT_KINDS.has(kind) || !isRecord(field)) {
      throw new Error('terminal authority app projection fact is invalid')
    }
    const event = assertTerminalAuthorityAppMatchingEvent(field.event, value)
    assertTerminalBinding(field.binding)
    assertSemanticFact(field.fact)
    assertSafeInteger(field.appliedAt, 'projection fact appliedAt')
    if (field.fact.kind !== kind || !bindingBelongsToRow(field.binding, value)) {
      throw new Error('terminal authority app projection fact identity changed')
    }
    if (kind === 'pr-link') {
      assertSafeInteger(field.verifyAfter, 'projection PR verification deadline')
      if (!['pending', 'verified', 'failed'].includes(String(field.verification))) {
        throw new Error('terminal authority app projection PR verification is invalid')
      }
    } else if (field.verifyAfter !== undefined || field.verification !== undefined) {
      throw new Error('terminal authority app projection fact fields conflict')
    }
    events.push(event)
  }
  return events
}

function assertDerivedProjection(
  value: Record<string, unknown>,
  factEvents: TerminalAuthorityAppEventKey[]
): void {
  const events = [...factEvents]
  if (value.exit !== undefined) {
    assertExit(value.exit, value, events)
  }
  if (value.agent !== undefined) {
    assertAgent(value.agent, value, events)
  }
  if (value.commandCode !== undefined) {
    assertCommandCode(value.commandCode, value, events)
  }
  const attention = assertAttention(value.attention, value, events)
  assertStatus(value.status, value, events, attention)
  if (isRecord(value.topology) && value.topology.event !== undefined) {
    events.push(assertTerminalAuthorityAppMatchingEvent(value.topology.event, value))
  }
  const latest =
    value.latestEvent === undefined
      ? null
      : assertTerminalAuthorityAppMatchingEvent(value.latestEvent, value)
  if (events.length > 0 && (!latest || events.some((event) => event.sequence > latest.sequence))) {
    throw new Error('terminal authority app projection latest event regressed')
  }
}

function assertExit(
  value: unknown,
  row: Record<string, unknown>,
  events: TerminalAuthorityAppEventKey[]
): void {
  if (!isRecord(value)) {
    throw new Error('terminal authority app projection exit is invalid')
  }
  events.push(assertTerminalAuthorityAppMatchingEvent(value.event, row))
  assertTerminalBinding(value.binding)
  if (!bindingBelongsToRow(value.binding, row)) {
    throw new Error('projection exit binding changed')
  }
  if (value.code !== null) {
    assertSafeInteger(value.code, 'projection exit code')
  }
  if (value.signal !== null && typeof value.signal !== 'string') {
    throw new Error('terminal authority app projection exit signal is invalid')
  }
}

function assertAgent(
  value: unknown,
  row: Record<string, unknown>,
  events: TerminalAuthorityAppEventKey[]
): void {
  if (
    !isRecord(value) ||
    !AGENT_STATES.has(String(value.state)) ||
    typeof value.prompt !== 'string'
  ) {
    throw new Error('terminal authority app projection agent is invalid')
  }
  events.push(assertTerminalAuthorityAppMatchingEvent(value.event, row))
  assertTerminalBinding(value.binding)
  assertSafeInteger(value.transitionedAt, 'projection agent transition')
  if (!bindingBelongsToRow(value.binding, row)) {
    throw new Error('projection agent binding changed')
  }
}

function assertCommandCode(
  value: unknown,
  row: Record<string, unknown>,
  events: TerminalAuthorityAppEventKey[]
): void {
  if (
    !isRecord(value) ||
    !['working', 'settling', 'done'].includes(String(value.state)) ||
    typeof value.prompt !== 'string'
  ) {
    throw new Error('terminal authority app projection Command Code state is invalid')
  }
  events.push(assertTerminalAuthorityAppMatchingEvent(value.event, row))
  assertTerminalBinding(value.binding)
  assertSafeInteger(value.transitionedAt, 'projection Command Code transition')
  if (value.settleAt !== null) {
    assertSafeInteger(value.settleAt, 'projection Command Code deadline')
  }
  if ((value.state === 'settling') !== (value.settleAt !== null)) {
    throw new Error('terminal authority app projection Command Code deadline is invalid')
  }
  if (!bindingBelongsToRow(value.binding, row)) {
    throw new Error('projection Command Code binding changed')
  }
}

function assertAttention(
  value: unknown,
  row: Record<string, unknown>,
  events: TerminalAuthorityAppEventKey[]
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('terminal authority app projection attention is invalid')
  }
  assertSafeInteger(value.pendingBellCount, 'projection bell count')
  assertSafeInteger(value.updatedAt, 'projection attention timestamp')
  if (Number(value.pendingBellCount) > 99) {
    throw new Error('projection bell count exceeds capacity')
  }
  if (value.event !== null) {
    events.push(assertTerminalAuthorityAppMatchingEvent(value.event, row))
  }
  return value
}

function assertStatus(
  value: unknown,
  row: Record<string, unknown>,
  events: TerminalAuthorityAppEventKey[],
  attention: Record<string, unknown>
): void {
  if (!isRecord(value) || !isRecord(row.topology)) {
    throw new Error('terminal authority app projection status is invalid')
  }
  assertSafeInteger(value.updatedAt, 'projection status timestamp')
  if (value.event !== null) {
    events.push(assertTerminalAuthorityAppMatchingEvent(value.event, row))
  }
  const agentState = isRecord(row.agent) ? row.agent.state : null
  if (
    value.pane !== row.topology.status ||
    value.agent !== agentState ||
    value.attention !== Number(attention.pendingBellCount) > 0
  ) {
    throw new Error('terminal authority app projection status conflicts')
  }
}

function assertLayout(value: unknown, paneKey: string): void {
  const expected = parsePaneKey(paneKey)
  if (
    expected === null
      ? value !== null
      : !isRecord(value) || value.tabId !== expected.tabId || value.leafId !== expected.leafId
  ) {
    throw new Error('terminal authority app projection layout is invalid')
  }
}

function bindingBelongsToRow(binding: unknown, row: Record<string, unknown>): boolean {
  if (!isRecord(row.topology)) {
    return false
  }
  return [row.topology.binding, row.topology.lastBinding].some(
    (candidate) => candidate !== null && sameTerminalBinding(binding as never, candidate as never)
  )
}

function sameNullableBinding(left: unknown, right: unknown): boolean {
  return left === null || right === null
    ? left === right
    : sameTerminalBinding(left as never, right as never)
}

function samePane(
  left: { paneKey: string; paneGenerationId: string },
  right: { paneKey: string; paneGenerationId: string }
): boolean {
  return left.paneKey === right.paneKey && left.paneGenerationId === right.paneGenerationId
}

function isVersionedRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.version === TERMINAL_AUTHORITY_APP_PROJECTION_VERSION
}

function isAuthorityId(value: unknown): value is string {
  try {
    assertAuthorityId(value, 'authority projection ID')
    return true
  } catch {
    return false
  }
}
