import { AGENT_STATUS_MAX_SUBAGENTS, type AgentSubagentSnapshot } from './agent-status-types'

const CODEX_SUBAGENT_ID_MAX_LENGTH = 64

export type CodexSubagentRoster = Map<string, TrackedCodexSubagent>

type TrackedCodexSubagent = {
  agentType?: string
  model?: string
  state: 'working' | 'waiting'
  startedAt: number
  /** Persisted rows need fresh lifecycle/tool evidence before they can keep a
   *  parent Stop gated after Orca restarts. */
  confirmedLive: boolean
}

export function upsertCodexSubagent(
  roster: CodexSubagentRoster,
  id: string,
  fields: {
    agentType?: string
    model?: string
    state: 'working' | 'waiting'
  },
  now: number
): void {
  if (id.length === 0 || id.length > CODEX_SUBAGENT_ID_MAX_LENGTH) {
    return
  }
  const existing = roster.get(id)
  if (existing) {
    existing.agentType = fields.agentType ?? existing.agentType
    existing.model = fields.model ?? existing.model
    existing.state = fields.state
    existing.confirmedLive = true
    return
  }
  if (roster.size >= AGENT_STATUS_MAX_SUBAGENTS) {
    return
  }
  roster.set(id, {
    agentType: fields.agentType,
    model: fields.model,
    state: fields.state,
    startedAt: now,
    confirmedLive: true
  })
}

export function finishCodexSubagent(roster: CodexSubagentRoster, id: string): void {
  roster.delete(id)
}

export function reapUnconfirmedCodexSubagents(roster: CodexSubagentRoster): void {
  for (const [id, tracked] of roster) {
    if (!tracked.confirmedLive) {
      roster.delete(id)
    }
  }
}

export function seedCodexSubagentRoster(
  roster: CodexSubagentRoster,
  snapshots: readonly AgentSubagentSnapshot[]
): void {
  for (const snapshot of snapshots) {
    if (snapshot.state !== 'working' && snapshot.state !== 'waiting') {
      continue
    }
    if (roster.size >= AGENT_STATUS_MAX_SUBAGENTS) {
      return
    }
    roster.set(snapshot.id, {
      agentType: snapshot.agentType,
      model: snapshot.model,
      state: snapshot.state,
      startedAt: snapshot.startedAt,
      confirmedLive: false
    })
  }
}

export function codexRosterToSnapshots(
  roster: CodexSubagentRoster | undefined
): AgentSubagentSnapshot[] | undefined {
  if (!roster || roster.size === 0) {
    return undefined
  }
  const snapshots = Array.from(roster, ([id, tracked]) => ({
    id,
    agentType: tracked.agentType,
    model: tracked.model,
    state: tracked.state,
    startedAt: tracked.startedAt
  }))
  snapshots.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
  return snapshots
}

export function codexRosterEffectiveState(
  roster: CodexSubagentRoster | undefined,
  leadState: 'working' | 'waiting' | 'done'
): 'working' | 'waiting' | 'done' {
  if (!roster || roster.size === 0) {
    return leadState
  }
  for (const tracked of roster.values()) {
    if (tracked.state === 'waiting') {
      return 'waiting'
    }
  }
  return leadState === 'done' ? 'working' : leadState
}
