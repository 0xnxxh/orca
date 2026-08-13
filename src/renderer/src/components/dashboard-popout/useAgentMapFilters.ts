import { useCallback, useMemo, useState } from 'react'
import type { DashboardCardHostKind } from '../../../../shared/dashboard-snapshot'
import { ALL_AGENT_MAP_HOSTS, type AgentMapState } from './agent-map-filter'
import {
  applyAgentMapQuickView,
  emptyAgentMapFilterState,
  ALL_AGENT_MAP_STATES,
  type AgentMapFilterState,
  type AgentMapQuickViewId
} from './agent-map-quick-views'
import {
  activeAgentMapTimeFields,
  fullAgentMapTimeRanges,
  type AgentMapTimeField,
  type AgentMapTimeRange
} from './agent-map-time-filter'

export type AgentMapFilterControls = AgentMapFilterState & {
  activeCount: number
  toggleState: (state: AgentMapState) => void
  toggleHost: (host: DashboardCardHostKind) => void
  toggleAgentType: (agentType: string) => void
  setTimeRange: (field: AgentMapTimeField, range: AgentMapTimeRange) => void
  resetTimeRanges: () => void
  setUnreadOnly: (only: boolean) => void
  setOrchestrationOnly: (only: boolean) => void
  applyQuickView: (id: AgentMapQuickViewId) => void
  reset: () => void
}

function toggle<T>(current: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(current)
  if (!next.delete(value)) {
    next.add(value)
  }
  return next
}

/** Map-only filter state. It lives on the board rather than inside the map so
 *  the shared toolbar filter — the map has no rail of its own — can drive it. */
export function useAgentMapFilters(agentTypes: readonly string[]): AgentMapFilterControls {
  const [filters, setFilters] = useState<AgentMapFilterState>(() =>
    emptyAgentMapFilterState(agentTypes)
  )
  // A provider that only appears after the first render must not arrive muted.
  const knownAgentTypes = useMemo(() => {
    const merged = new Set(filters.agentTypes)
    for (const agentType of agentTypes) {
      if (!filters.agentTypes.has(agentType)) {
        merged.add(agentType)
      }
    }
    return merged
  }, [agentTypes, filters.agentTypes])

  const patch = useCallback(
    (next: Partial<AgentMapFilterState>) => setFilters((current) => ({ ...current, ...next })),
    []
  )

  const activeCount =
    (filters.states.size === ALL_AGENT_MAP_STATES.length ? 0 : 1) +
    (filters.hosts.size === ALL_AGENT_MAP_HOSTS.length ? 0 : 1) +
    (knownAgentTypes.size === agentTypes.length ? 0 : 1) +
    activeAgentMapTimeFields(filters.timeRanges).length +
    (filters.unreadOnly ? 1 : 0) +
    (filters.orchestrationOnly ? 1 : 0)

  return {
    ...filters,
    agentTypes: knownAgentTypes,
    activeCount,
    toggleState: useCallback(
      (state) => setFilters((c) => ({ ...c, states: toggle(c.states, state) })),
      []
    ),
    toggleHost: useCallback(
      (host) => setFilters((c) => ({ ...c, hosts: toggle(c.hosts, host) })),
      []
    ),
    toggleAgentType: useCallback(
      (agentType) => setFilters((c) => ({ ...c, agentTypes: toggle(c.agentTypes, agentType) })),
      []
    ),
    setTimeRange: useCallback(
      (field, range) =>
        setFilters((c) => ({ ...c, timeRanges: { ...c.timeRanges, [field]: range } })),
      []
    ),
    resetTimeRanges: useCallback(() => patch({ timeRanges: fullAgentMapTimeRanges() }), [patch]),
    setUnreadOnly: useCallback((only) => patch({ unreadOnly: only }), [patch]),
    setOrchestrationOnly: useCallback((only) => patch({ orchestrationOnly: only }), [patch]),
    applyQuickView: useCallback(
      (id) => setFilters(applyAgentMapQuickView(id, agentTypes)),
      [agentTypes]
    ),
    reset: useCallback(() => setFilters(emptyAgentMapFilterState(agentTypes)), [agentTypes])
  }
}
