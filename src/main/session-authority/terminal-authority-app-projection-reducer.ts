import { isDeepStrictEqual } from 'node:util'
import type {
  TerminalAuthorityAppEventKey,
  TerminalAuthorityAppPaneProjection,
  TerminalAuthorityAppTopologyProjection
} from '../../shared/terminal-authority-app-projection'
import { sameTerminalBinding } from '../../shared/terminal-session-authority-identity'
import type {
  TerminalAuthorityDurableOutcome,
  TerminalPaneAuthorityRecord,
  TerminalSessionAuthorityEffect
} from '../../shared/terminal-session-authority-mutation'
import { parsePaneKey } from '../../shared/stable-pane-id'
import {
  terminalAuthorityAppEventAlreadyProjected,
  terminalAuthorityAppProjectionEventKey,
  terminalAuthorityAppStatusProjection
} from './terminal-authority-app-projection-event-state'
import { reduceTerminalAuthorityAppSemanticProjection } from './terminal-authority-app-semantic-projection'

export {
  TERMINAL_AUTHORITY_COMMAND_CODE_SETTLE_MS,
  TERMINAL_AUTHORITY_PR_VERIFY_DELAY_MS,
  settleTerminalAuthorityCommandCodeProjections,
  terminalAuthorityAppPrVerificationsDue
} from './terminal-authority-app-semantic-projection'

export type TerminalAuthorityAppProjectionRowLookup = (
  consumerId: string,
  outcome: TerminalAuthorityDurableOutcome,
  pane: Readonly<{ paneKey: string; paneGenerationId: string }>
) => TerminalAuthorityAppPaneProjection | null

export function reduceTerminalAuthorityAppProjection(
  consumerId: string,
  outcome: TerminalAuthorityDurableOutcome,
  lookup: TerminalAuthorityAppProjectionRowLookup,
  now: number
): readonly TerminalAuthorityAppPaneProjection[] {
  return outcome.kind === 'semantic'
    ? reduceTerminalAuthorityAppSemanticProjection(consumerId, outcome, lookup, now)
    : reduceMutationOutcome(consumerId, outcome, lookup, now)
}

function reduceMutationOutcome(
  consumerId: string,
  outcome: Exclude<TerminalAuthorityDurableOutcome, { kind: 'semantic' }>,
  lookup: TerminalAuthorityAppProjectionRowLookup,
  now: number
): readonly TerminalAuthorityAppPaneProjection[] {
  const event = terminalAuthorityAppProjectionEventKey(consumerId, outcome)
  const changed: TerminalAuthorityAppPaneProjection[] = []
  const records = [outcome.result.pane, outcome.result.replacementPane].filter(
    (record): record is TerminalPaneAuthorityRecord => record !== null
  )
  for (const record of records) {
    const current = lookup(consumerId, outcome, record)
    if (current && terminalAuthorityAppEventAlreadyProjected(current, event)) {
      continue
    }
    const topology = projectTopology(current?.topology, event, record)
    const keepsBindingState = current ? sameBindingContext(current.topology, topology) : false
    const base = current ?? emptyRow(consumerId, outcome, record, topology, now)
    const retained = keepsBindingState ? base : clearBindingState(base, topology, now)
    const exitEffect = findExitEffect(outcome.result.effects, topology)
    const exit = exitEffect
      ? Object.freeze({
          event,
          binding: Object.freeze({ ...exitEffect.binding }),
          code: exitEffect.code,
          signal: exitEffect.signal
        })
      : retained.exit
    const agent = exitEffect
      ? Object.freeze({
          event,
          binding: Object.freeze({ ...exitEffect.binding }),
          state: 'exited' as const,
          prompt: retained.agent?.prompt ?? '',
          transitionedAt: now
        })
      : retained.agent
    const allocation = allocationForRecord(outcome, record, retained)
    const candidate = {
      ...retained,
      binding: topology.binding,
      topology,
      latestEvent: event,
      ...(exit ? { exit } : {}),
      ...(agent ? { agent } : {}),
      status: terminalAuthorityAppStatusProjection(
        retained,
        event,
        now,
        agent,
        topology,
        retained.attention
      )
    }
    if (allocation) {
      changed.push(Object.freeze({ ...candidate, allocation }))
    } else {
      const { allocation: _allocation, ...withoutAllocation } = candidate
      changed.push(Object.freeze(withoutAllocation))
    }
  }
  return Object.freeze(changed)
}

function projectTopology(
  current: TerminalAuthorityAppTopologyProjection | undefined,
  event: TerminalAuthorityAppEventKey,
  record: TerminalPaneAuthorityRecord
): TerminalAuthorityAppTopologyProjection {
  const candidate = topologyFromRecord(record, event, current?.ownerStatus ?? null)
  if (!current || record.revision > current.authorityRevision) {
    return candidate
  }
  if (record.revision < current.authorityRevision) {
    return current
  }
  const { event: _currentEvent, ...currentRecord } = current
  const { event: _candidateEvent, ...candidateRecord } = candidate
  if (!isDeepStrictEqual(currentRecord, candidateRecord)) {
    throw new Error('terminal authority app projection topology conflicts')
  }
  return current.event ? current : candidate
}

export function topologyFromRecord(
  record: TerminalPaneAuthorityRecord & { ownerStatus?: 'reachable' | 'owner-unreachable' | null },
  event?: TerminalAuthorityAppEventKey,
  fallbackOwnerStatus: 'reachable' | 'owner-unreachable' | null = null
): TerminalAuthorityAppTopologyProjection {
  return Object.freeze({
    ...(event ? { event } : {}),
    status: record.status,
    binding: record.binding ? Object.freeze({ ...record.binding }) : null,
    lastBinding: record.lastBinding ? Object.freeze({ ...record.lastBinding }) : null,
    authorityRevision: record.revision,
    ownerStatus: record.ownerStatus ?? fallbackOwnerStatus
  })
}

function emptyRow(
  consumerId: string,
  outcome: TerminalAuthorityDurableOutcome,
  pane: Readonly<{ paneKey: string; paneGenerationId: string }>,
  topology: TerminalAuthorityAppTopologyProjection,
  now: number
): TerminalAuthorityAppPaneProjection {
  const parsed = parsePaneKey(pane.paneKey)
  return Object.freeze({
    version: 1,
    consumerId,
    namespace: Object.freeze({
      ...(outcome.kind === 'semantic' ? outcome.access.namespace : outcome.result.namespace)
    }),
    pane: Object.freeze({ ...pane }),
    layout: parsed ? Object.freeze({ tabId: parsed.tabId, leafId: parsed.leafId }) : null,
    binding: topology.binding,
    topology,
    attention: Object.freeze({ event: null, pendingBellCount: 0, updatedAt: now }),
    status: Object.freeze({
      event: null,
      pane: topology.status,
      agent: null,
      attention: false,
      updatedAt: now
    }),
    facts: Object.freeze({})
  })
}

function clearBindingState(
  row: TerminalAuthorityAppPaneProjection,
  topology: TerminalAuthorityAppTopologyProjection,
  now: number
): TerminalAuthorityAppPaneProjection {
  const {
    allocation: _allocation,
    exit: _exit,
    agent: _agent,
    commandCode: _commandCode,
    ...retained
  } = row
  return Object.freeze({
    ...retained,
    binding: topology.binding,
    topology,
    attention: Object.freeze({ event: null, pendingBellCount: 0, updatedAt: now }),
    status: Object.freeze({
      event: null,
      pane: topology.status,
      agent: null,
      attention: false,
      updatedAt: now
    }),
    facts: Object.freeze({})
  })
}

function sameBindingContext(
  current: TerminalAuthorityAppTopologyProjection,
  next: TerminalAuthorityAppTopologyProjection
): boolean {
  const previousBinding = current.binding ?? current.lastBinding
  const nextBinding = next.binding ?? next.lastBinding
  return Boolean(
    previousBinding && nextBinding && sameTerminalBinding(previousBinding, nextBinding)
  )
}

function findExitEffect(
  effects: readonly TerminalSessionAuthorityEffect[],
  topology: TerminalAuthorityAppTopologyProjection
): Extract<TerminalSessionAuthorityEffect, { kind: 'terminal-exited' }> | undefined {
  const binding = topology.binding ?? topology.lastBinding
  return binding
    ? effects.find(
        (effect): effect is Extract<TerminalSessionAuthorityEffect, { kind: 'terminal-exited' }> =>
          effect.kind === 'terminal-exited' && sameTerminalBinding(effect.binding, binding)
      )
    : undefined
}

function allocationForRecord(
  outcome: Exclude<TerminalAuthorityDurableOutcome, { kind: 'semantic' }>,
  record: TerminalPaneAuthorityRecord,
  current: TerminalAuthorityAppPaneProjection
) {
  const allocation = outcome.result.allocation
  if (
    allocation?.pane.paneKey === record.paneKey &&
    allocation.pane.paneGenerationId === record.paneGenerationId
  ) {
    return Object.freeze(structuredClone(allocation))
  }
  return outcome.request.change.kind === 'cancel-allocation' ? undefined : current.allocation
}
