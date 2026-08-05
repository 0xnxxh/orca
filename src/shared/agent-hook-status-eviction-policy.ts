// Why: one eviction policy for every bounded agent-hook status container. The pane-keyed
// listener cache and the daemon's terminal-keyed binding store must shed entries identically,
// so the policy lives here and both callers delegate instead of forking their own rules.

import { AGENT_STATUS_STALE_AFTER_MS, type AgentStatusState } from './agent-status-types'

/** Maximum tracked entries in a bounded agent-hook status container. */
export const MAX_AGENT_HOOK_STATUS_ENTRIES = 500

/** The only entry fields the policy reads; callers project their own rows onto it. */
export type AgentHookStatusEvictionCandidate = {
  state: AgentStatusState
  /** Last refresh time; an entry without one is never treated as stale. */
  receivedAt?: number
}

export function assertAgentHookStatusBound(max: number): void {
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new RangeError('Agent hook status cache limit must be a positive safe integer')
  }
}

/**
 * Pick the entry to drop when a container exceeds its bound: the first `done` or stale
 * entry in insertion order, else the oldest inserted. `protectedKey` — the row just
 * written — is never chosen, so a burst can never evict the event it is delivering.
 */
export function selectAgentHookStatusEvictionKey<K>(
  entries: Iterable<readonly [K, AgentHookStatusEvictionCandidate]>,
  protectedKey: K,
  now: number,
  staleAfterMs: number = AGENT_STATUS_STALE_AFTER_MS
): K | undefined {
  let oldestFallback: K | undefined
  let hasFallback = false
  for (const [key, candidate] of entries) {
    if (key === protectedKey) {
      continue
    }
    if (!hasFallback) {
      oldestFallback = key
      hasFallback = true
    }
    if (candidate.state === 'done' || isStaleCandidate(candidate, now, staleAfterMs)) {
      return key
    }
  }
  return oldestFallback
}

function isStaleCandidate(
  candidate: AgentHookStatusEvictionCandidate,
  now: number,
  staleAfterMs: number
): boolean {
  const { receivedAt } = candidate
  return (
    typeof receivedAt === 'number' && Number.isFinite(receivedAt) && now - receivedAt > staleAfterMs
  )
}
