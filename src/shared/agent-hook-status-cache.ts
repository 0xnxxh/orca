// Migration note: the eviction policy that used to live here now lives in
// agent-hook-status-eviction-policy.ts, shared with the daemon-side binding store
// (agent-hook-binding-store.ts). This file stays as the pane-keyed adapter over that policy
// for HookListenerState; new terminal-scoped callers should use the binding store instead.

import {
  clearPaneCacheState,
  type AgentHookEventPayload,
  type HookListenerState
} from './agent-hook-listener'
import {
  assertAgentHookStatusBound,
  MAX_AGENT_HOOK_STATUS_ENTRIES,
  selectAgentHookStatusEvictionKey,
  type AgentHookStatusEvictionCandidate
} from './agent-hook-status-eviction-policy'

/** @deprecated Prefer MAX_AGENT_HOOK_STATUS_ENTRIES; kept for existing pane-keyed callers. */
export const MAX_AGENT_HOOK_STATUS_CACHE_PANES = MAX_AGENT_HOOK_STATUS_ENTRIES

export type AgentHookStatusCacheEviction = {
  paneKey: string
  entry: AgentHookEventPayload
}

export function upsertBoundedAgentHookStatus(
  state: HookListenerState,
  entry: AgentHookEventPayload,
  options: { maxPanes?: number; now?: number } = {}
): AgentHookStatusCacheEviction[] {
  const maxPanes = options.maxPanes ?? MAX_AGENT_HOOK_STATUS_ENTRIES
  assertAgentHookStatusBound(maxPanes)

  state.lastStatusByPaneKey.delete(entry.paneKey)
  state.lastStatusByPaneKey.set(entry.paneKey, entry)
  const evicted: AgentHookStatusCacheEviction[] = []
  const now = options.now ?? Date.now()
  while (state.lastStatusByPaneKey.size > maxPanes) {
    const paneKey = selectAgentHookStatusEvictionKey(evictionCandidates(state), entry.paneKey, now)
    if (!paneKey) {
      break
    }
    const cached = state.lastStatusByPaneKey.get(paneKey)
    if (!cached) {
      break
    }
    evicted.push({ paneKey, entry: cached })
    clearPaneCacheState(state, paneKey)
  }
  return evicted
}

function* evictionCandidates(
  state: HookListenerState
): Iterable<readonly [string, AgentHookStatusEvictionCandidate]> {
  for (const [paneKey, entry] of state.lastStatusByPaneKey) {
    const receivedAt = (entry as AgentHookEventPayload & { receivedAt?: unknown }).receivedAt
    yield [
      paneKey,
      {
        state: entry.payload.state,
        receivedAt: typeof receivedAt === 'number' ? receivedAt : undefined
      }
    ]
  }
}
