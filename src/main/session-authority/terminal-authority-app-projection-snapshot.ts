import { isDeepStrictEqual } from 'node:util'
import {
  TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
  terminalAuthorityAppProjectionRowKey,
  type TerminalAuthorityAppEventKey,
  type TerminalAuthorityAppPaneProjection,
  type TerminalAuthorityAppProjectionRowIdentity,
  type TerminalAuthorityAppTopologyProjection
} from '../../shared/terminal-authority-app-projection'
import { sameTerminalBinding } from '../../shared/terminal-session-authority-identity'
import type {
  TerminalAuthorityDurableOutcome,
  TerminalAuthorityProjection,
  TerminalPaneAuthorityProjection,
  TerminalSessionPtyAllocation
} from '../../shared/terminal-session-authority-mutation'
import { terminalAuthorityMaterializedOutcomeMatchesBinding } from '../../shared/terminal-session-authority-materialized-outcomes'
import { parsePaneKey } from '../../shared/stable-pane-id'
import {
  latestTerminalAuthorityAppProjectionEvent,
  sameTerminalAuthorityAppProjectionEvent
} from './terminal-authority-app-projection-event-state'
import {
  reduceTerminalAuthorityAppProjection,
  topologyFromRecord
} from './terminal-authority-app-projection-reducer'

export type TerminalAuthorityAppSnapshotReconciliation = Readonly<{
  rows: readonly TerminalAuthorityAppPaneProjection[]
  deleted: readonly TerminalAuthorityAppProjectionRowIdentity[]
}>

export function reconcileTerminalAuthorityAppProjectionSnapshot(
  consumerId: string,
  projection: TerminalAuthorityProjection,
  currentRows: readonly TerminalAuthorityAppPaneProjection[],
  now: number
): TerminalAuthorityAppSnapshotReconciliation {
  const current = new Map(
    currentRows.map((row) => [terminalAuthorityAppProjectionRowKey(row), row])
  )
  const allocations = allocationsByPane(projection.allocations)
  const projected = new Map<string, TerminalAuthorityAppPaneProjection>()
  for (const pane of projection.panes) {
    const identity = { consumerId, namespace: projection.namespace, pane }
    const key = terminalAuthorityAppProjectionRowKey(identity)
    projected.set(
      key,
      snapshotRow(
        consumerId,
        projection,
        pane,
        allocations.get(paneKey(pane)),
        current.get(key),
        now
      )
    )
  }
  applyMaterializedOutcomes(consumerId, projection, projected, now)
  const rows = [...projected.entries()]
    .map(([key, row]) =>
      mergeLocalProjection(current.get(key), row, projection.materializedOutcomes ?? [], now)
    )
    .filter(
      (row) => !isDeepStrictEqual(current.get(terminalAuthorityAppProjectionRowKey(row)), row)
    )
  const deleted = currentRows
    .filter((row) => !projected.has(terminalAuthorityAppProjectionRowKey(row)))
    .map(rowIdentity)
  return Object.freeze({ rows: Object.freeze(rows), deleted: Object.freeze(deleted) })
}

function snapshotRow(
  consumerId: string,
  projection: TerminalAuthorityProjection,
  pane: TerminalPaneAuthorityProjection,
  allocation: TerminalSessionPtyAllocation | undefined,
  current: TerminalAuthorityAppPaneProjection | undefined,
  now: number
): TerminalAuthorityAppPaneProjection {
  const candidateTopology = topologyFromRecord(pane)
  const topology = current
    ? reconcileTopology(current.topology, candidateTopology)
    : candidateTopology
  return emptySnapshotRow(consumerId, projection, pane, topology, allocation, now)
}

function applyMaterializedOutcomes(
  consumerId: string,
  projection: TerminalAuthorityProjection,
  rows: Map<string, TerminalAuthorityAppPaneProjection>,
  now: number
): void {
  for (const outcome of projection.materializedOutcomes ?? []) {
    const changed = reduceTerminalAuthorityAppProjection(
      consumerId,
      outcome,
      (_consumerId, _outcome, pane) =>
        rows.get(
          terminalAuthorityAppProjectionRowKey({
            consumerId,
            namespace: projection.namespace,
            pane
          })
        ) ?? null,
      now
    )
    for (const row of changed) {
      const key = terminalAuthorityAppProjectionRowKey(row)
      if (!rows.has(key)) {
        throw new Error('terminal authority app projection materialized an absent pane')
      }
      rows.set(key, row)
    }
  }
}

function mergeLocalProjection(
  current: TerminalAuthorityAppPaneProjection | undefined,
  authority: TerminalAuthorityAppPaneProjection,
  materializedOutcomes: readonly TerminalAuthorityDurableOutcome[],
  now: number
): TerminalAuthorityAppPaneProjection {
  if (!current || !sameBindingContext(current.topology, authority.topology)) {
    return authority
  }
  const facts = Object.fromEntries(
    Object.entries(authority.facts).map(([kind, field]) => [
      kind,
      field
        ? preserveEventProjection(current.facts[kind as keyof typeof current.facts], field)
        : field
    ])
  ) as TerminalAuthorityAppPaneProjection['facts']
  const exit = preserveEventProjection(current.exit, authority.exit)
  const agent = preserveEventProjection(current.agent, authority.agent)
  const commandCode = preserveEventProjection(current.commandCode, authority.commandCode)
  const attention = mergeLocalAttention(current, authority, materializedOutcomes)
  const latestEvent = latestTerminalAuthorityAppProjectionEvent(
    current.latestEvent,
    authority.latestEvent
  )
  const statusValues = {
    pane: authority.topology.status,
    agent: agent?.state ?? null,
    attention: attention.pendingBellCount > 0
  }
  const status =
    sameNullableEvent(current.status.event, authority.status.event) &&
    current.status.pane === statusValues.pane &&
    current.status.agent === statusValues.agent &&
    current.status.attention === statusValues.attention
      ? current.status
      : Object.freeze({ ...authority.status, ...statusValues, updatedAt: now })
  const {
    exit: _exit,
    agent: _agent,
    commandCode: _commandCode,
    latestEvent: _latestEvent,
    ...base
  } = authority
  return Object.freeze({
    ...base,
    ...(latestEvent ? { latestEvent } : {}),
    facts: Object.freeze(facts),
    attention,
    status,
    ...(exit ? { exit } : {}),
    ...(agent ? { agent } : {}),
    ...(commandCode ? { commandCode } : {})
  })
}

function mergeLocalAttention(
  current: TerminalAuthorityAppPaneProjection,
  authority: TerminalAuthorityAppPaneProjection,
  materializedOutcomes: readonly TerminalAuthorityDurableOutcome[]
): TerminalAuthorityAppPaneProjection['attention'] {
  if (sameNullableEvent(current.attention.event, authority.attention.event)) {
    return current.attention
  }
  const clearedThrough = current.attention.event
  const binding = authority.binding ?? authority.topology.lastBinding
  if (current.attention.pendingBellCount !== 0 || !clearedThrough || !binding) {
    return authority.attention
  }
  const pendingBellCount = materializedOutcomes.filter(
    (outcome) =>
      outcome.kind === 'semantic' &&
      outcome.fact.kind === 'bell' &&
      outcome.sequence > clearedThrough.sequence &&
      terminalAuthorityMaterializedOutcomeMatchesBinding(outcome, authority.pane, binding)
  ).length
  return Object.freeze({
    event: authority.attention.event,
    pendingBellCount,
    updatedAt: authority.attention.updatedAt
  })
}

function preserveEventProjection<T extends { event: TerminalAuthorityAppEventKey }>(
  current: T | undefined,
  authority: T | undefined
): T | undefined {
  return current &&
    authority &&
    sameTerminalAuthorityAppProjectionEvent(current.event, authority.event)
    ? current
    : authority
}

function sameNullableEvent(
  left: TerminalAuthorityAppEventKey | null | undefined,
  right: TerminalAuthorityAppEventKey | null | undefined
): boolean {
  return left === null || left === undefined || right === null || right === undefined
    ? left === right
    : sameTerminalAuthorityAppProjectionEvent(left, right)
}

function reconcileTopology(
  current: TerminalAuthorityAppTopologyProjection,
  candidate: TerminalAuthorityAppTopologyProjection
): TerminalAuthorityAppTopologyProjection {
  if (candidate.authorityRevision < current.authorityRevision) {
    throw new Error('terminal authority app projection snapshot regressed')
  }
  const { event: _currentEvent, ownerStatus: currentOwnerStatus, ...currentDurable } = current
  const {
    event: _candidateEvent,
    ownerStatus: candidateOwnerStatus,
    ...candidateDurable
  } = candidate
  if (
    candidate.authorityRevision === current.authorityRevision &&
    !isDeepStrictEqual(currentDurable, candidateDurable)
  ) {
    throw new Error('terminal authority app projection snapshot conflicts')
  }
  if (isDeepStrictEqual(currentDurable, candidateDurable)) {
    return currentOwnerStatus === candidateOwnerStatus
      ? current
      : Object.freeze({ ...current, ownerStatus: candidateOwnerStatus })
  }
  return candidate
}

function emptySnapshotRow(
  consumerId: string,
  projection: TerminalAuthorityProjection,
  pane: TerminalPaneAuthorityProjection,
  topology: TerminalAuthorityAppTopologyProjection,
  allocation: TerminalSessionPtyAllocation | undefined,
  now: number
): TerminalAuthorityAppPaneProjection {
  return Object.freeze({
    version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
    consumerId,
    namespace: Object.freeze({ ...projection.namespace }),
    pane: Object.freeze({ paneKey: pane.paneKey, paneGenerationId: pane.paneGenerationId }),
    layout: layoutFor(pane.paneKey),
    binding: topology.binding,
    topology,
    ...(allocation ? { allocation: Object.freeze(structuredClone(allocation)) } : {}),
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

function allocationsByPane(
  allocations: readonly TerminalSessionPtyAllocation[]
): ReadonlyMap<string, TerminalSessionPtyAllocation> {
  const byPane = new Map<string, TerminalSessionPtyAllocation>()
  for (const allocation of allocations) {
    const key = paneKey(allocation.pane)
    if (byPane.has(key)) {
      throw new Error('terminal authority app projection snapshot duplicates an allocation')
    }
    byPane.set(key, allocation)
  }
  return byPane
}

function layoutFor(paneKeyValue: string): TerminalAuthorityAppPaneProjection['layout'] {
  const parsed = parsePaneKey(paneKeyValue)
  return parsed ? Object.freeze({ tabId: parsed.tabId, leafId: parsed.leafId }) : null
}

function sameBindingContext(
  current: TerminalAuthorityAppTopologyProjection,
  next: TerminalAuthorityAppTopologyProjection
): boolean {
  const before = current.binding ?? current.lastBinding
  const after = next.binding ?? next.lastBinding
  return Boolean(before && after && sameTerminalBinding(before, after))
}

function rowIdentity(
  row: TerminalAuthorityAppPaneProjection
): TerminalAuthorityAppProjectionRowIdentity {
  return Object.freeze({ consumerId: row.consumerId, namespace: row.namespace, pane: row.pane })
}

function paneKey(pane: { paneKey: string; paneGenerationId: string }): string {
  return JSON.stringify([pane.paneKey, pane.paneGenerationId])
}
