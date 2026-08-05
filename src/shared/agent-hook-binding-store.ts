// Why: daemon-side authoritative container for the latest agent hook status per terminal
// incarnation. The PTY owner — not the renderer — decides which agent a terminal is bound to,
// so this store fences late events from reaped incarnations and superseded launch tokens
// (the relay ghost-row bug class). Node-only: no Electron, no timers, no ambient clock.

import { createHash } from 'node:crypto'

import type { AgentHookSource } from './agent-hook-relay'
import { AGENT_STATUS_STATES, type ParsedAgentStatusPayload } from './agent-status-types'
import {
  assertAgentHookStatusBound,
  MAX_AGENT_HOOK_STATUS_ENTRIES,
  selectAgentHookStatusEvictionKey,
  type AgentHookStatusEvictionCandidate
} from './agent-hook-status-eviction-policy'

/** Binding-count bound; shares the pane cache's policy and ceiling. */
export const MAX_AGENT_HOOK_BINDINGS = MAX_AGENT_HOOK_STATUS_ENTRIES
/**
 * Cleared incarnations remembered so late events reject instead of resurrecting a reaped
 * terminal. Sized well above any realistic live-terminal count so the oldest tombstone is
 * only dropped long after its terminal could still be emitting; past that horizon a late
 * event is indistinguishable from a fresh one and is allowed through.
 */
export const MAX_CLEARED_TERMINAL_INCARNATIONS = 2000
/** Identity length cap, matching the hook listener's pane-key ceiling. */
export const AGENT_HOOK_BINDING_MAX_IDENTITY_LENGTH = 200

const KEY_SEPARATOR = '\u0000'
const VALID_STATES: ReadonlySet<string> = new Set<string>(AGENT_STATUS_STATES)

export type AgentHookBindingRejectionReason =
  /** Missing, over-long, or separator-bearing terminal handle / incarnation id. */
  | 'invalid-terminal-identity'
  /** receivedAt was not a finite number, so ordering could not be decided. */
  | 'invalid-received-at'
  /** Payload was not an object carrying a known agent status state. */
  | 'invalid-payload'
  /** The incarnation was cleared (reaped); bindings are never resurrected. */
  | 'cleared-terminal-incarnation'
  /** A different launch token that is not strictly newer than the live binding. */
  | 'stale-launch-token'
  /** Same launch token, older than the live binding. */
  | 'stale-event'

export type AgentHookBinding = {
  terminalHandle: string
  terminalIncarnationId: string
  /** Optional metadata: main deletes ORCA_PANE_KEY when the pane is unproven, so a
   *  binding must work without it. Never part of the identity key. */
  paneKey?: string
  /** Hash of the launch token, never the token itself. Used only for generation fencing. */
  launchTokenHash?: string
  source?: AgentHookSource
  receivedAt: number
  /** Store revision at which this binding was last accepted. */
  revision: number
  /** Pre-normalized by the caller (see module contract); treated as immutable. */
  payload: ParsedAgentStatusPayload
}

export type AgentHookBindingEvent = {
  terminalHandle: string
  terminalIncarnationId: string
  paneKey?: string
  /** Raw token; hashed on entry so the store never retains the secret. */
  launchToken?: string
  /** Pre-hashed token, for callers that already hashed it upstream. */
  launchTokenHash?: string
  source?: AgentHookSource
  receivedAt: number
  payload: ParsedAgentStatusPayload
}

export type AgentHookBindingApplyResult =
  | {
      accepted: true
      binding: AgentHookBinding
      revision: number
      /** Bindings dropped to stay under the bound. Evicted ≠ cleared: no tombstone, so a
       *  later event from the same live terminal re-creates the binding. */
      evicted: AgentHookBinding[]
    }
  | { accepted: false; reason: AgentHookBindingRejectionReason }

export type AgentHookBindingClearResult = {
  /** True when a live binding was removed (false when only a tombstone was recorded). */
  removed: boolean
  revision: number
  binding?: AgentHookBinding
}

export type AgentHookBindingSnapshot = {
  revision: number
  /** Least-recently-accepted first. Omission is the authoritative "binding is gone" signal. */
  bindings: AgentHookBinding[]
}

export type AgentHookBindingStore = {
  applyEvent(event: AgentHookBindingEvent, options?: { now?: number }): AgentHookBindingApplyResult
  clearTerminalIncarnation(
    terminalHandle: string,
    terminalIncarnationId: string
  ): AgentHookBindingClearResult
  getBinding(terminalHandle: string, terminalIncarnationId: string): AgentHookBinding | undefined
  snapshot(): AgentHookBindingSnapshot
}

/** Stable, non-reversible launch-token identity for generation fencing. */
export function hashAgentLaunchToken(launchToken: string): string {
  return createHash('sha256').update(launchToken).digest('hex').slice(0, 32)
}

/**
 * Latest-wins bindings keyed by terminal identity (handle + incarnation id).
 *
 * Trust boundary: payloads are assumed already normalized by
 * `normalizeAgentStatusPayload` — field caps and structure limits are enforced upstream at
 * ingest. The store only re-checks the shape it depends on (an object with a known state and
 * a string prompt) so a malformed value can never take a binding slot.
 */
export function createAgentHookBindingStore(
  options: { maxBindings?: number; maxClearedIncarnations?: number } = {}
): AgentHookBindingStore {
  const maxBindings = options.maxBindings ?? MAX_AGENT_HOOK_BINDINGS
  const maxClearedIncarnations = options.maxClearedIncarnations ?? MAX_CLEARED_TERMINAL_INCARNATIONS
  assertAgentHookStatusBound(maxBindings)
  assertAgentHookStatusBound(maxClearedIncarnations)

  const bindings = new Map<string, AgentHookBinding>()
  const clearedIncarnations = new Set<string>()
  let revision = 0

  function applyEvent(
    event: AgentHookBindingEvent,
    applyOptions: { now?: number } = {}
  ): AgentHookBindingApplyResult {
    const terminalHandle = normalizeIdentity(event.terminalHandle)
    const terminalIncarnationId = normalizeIdentity(event.terminalIncarnationId)
    if (!terminalHandle || !terminalIncarnationId) {
      return { accepted: false, reason: 'invalid-terminal-identity' }
    }
    if (!Number.isFinite(event.receivedAt)) {
      return { accepted: false, reason: 'invalid-received-at' }
    }
    if (!isAgentStatusPayloadShape(event.payload)) {
      return { accepted: false, reason: 'invalid-payload' }
    }

    const key = bindingKey(terminalHandle, terminalIncarnationId)
    if (clearedIncarnations.has(key)) {
      return { accepted: false, reason: 'cleared-terminal-incarnation' }
    }

    const launchTokenHash = resolveLaunchTokenHash(event)
    const current = bindings.get(key)
    if (current) {
      // Why: a different launch token means a different agent generation — it may only take
      // over when strictly newer, so a delayed event from the previous agent (or an untokened
      // event) can never clobber the agent now living in this terminal.
      const sameLaunch = current.launchTokenHash === launchTokenHash
      if (
        sameLaunch ? event.receivedAt < current.receivedAt : event.receivedAt <= current.receivedAt
      ) {
        return { accepted: false, reason: sameLaunch ? 'stale-event' : 'stale-launch-token' }
      }
    }

    revision += 1
    const paneKey = normalizeIdentity(event.paneKey)
    const binding: AgentHookBinding = {
      terminalHandle,
      terminalIncarnationId,
      receivedAt: event.receivedAt,
      revision,
      payload: event.payload,
      ...(paneKey ? { paneKey } : {}),
      ...(launchTokenHash ? { launchTokenHash } : {}),
      ...(event.source ? { source: event.source } : {})
    }
    // Why: re-insert so Map iteration order stays acceptance order — the eviction policy's
    // "oldest inserted" fallback depends on it.
    bindings.delete(key)
    bindings.set(key, binding)

    const evicted = evictOverflow(key, applyOptions.now ?? event.receivedAt)
    return { accepted: true, binding: { ...binding }, revision, evicted }
  }

  function evictOverflow(protectedKey: string, now: number): AgentHookBinding[] {
    const evicted: AgentHookBinding[] = []
    while (bindings.size > maxBindings) {
      const key = selectAgentHookStatusEvictionKey(evictionCandidates(), protectedKey, now)
      if (!key) {
        break
      }
      const dropped = bindings.get(key)
      if (!dropped) {
        break
      }
      bindings.delete(key)
      evicted.push(dropped)
    }
    return evicted
  }

  function* evictionCandidates(): Iterable<readonly [string, AgentHookStatusEvictionCandidate]> {
    for (const [key, binding] of bindings) {
      yield [key, { state: binding.payload.state, receivedAt: binding.receivedAt }]
    }
  }

  function clearTerminalIncarnation(
    terminalHandle: string,
    terminalIncarnationId: string
  ): AgentHookBindingClearResult {
    const handle = normalizeIdentity(terminalHandle)
    const incarnationId = normalizeIdentity(terminalIncarnationId)
    if (!handle || !incarnationId) {
      return { removed: false, revision }
    }
    const key = bindingKey(handle, incarnationId)
    const existing = bindings.get(key)
    const alreadyTombstoned = clearedIncarnations.has(key)
    if (!existing && alreadyTombstoned) {
      return { removed: false, revision }
    }
    bindings.delete(key)
    if (!alreadyTombstoned) {
      clearedIncarnations.add(key)
      // FIFO by first-clear time: the longest-dead incarnation is the least likely to still
      // have an event in flight.
      while (clearedIncarnations.size > maxClearedIncarnations) {
        const oldest = clearedIncarnations.values().next()
        if (oldest.done) {
          break
        }
        clearedIncarnations.delete(oldest.value)
      }
    }
    revision += 1
    return {
      removed: Boolean(existing),
      revision,
      ...(existing ? { binding: { ...existing } } : {})
    }
  }

  return {
    applyEvent,
    clearTerminalIncarnation,
    getBinding(terminalHandle, terminalIncarnationId) {
      const handle = normalizeIdentity(terminalHandle)
      const incarnationId = normalizeIdentity(terminalIncarnationId)
      if (!handle || !incarnationId) {
        return undefined
      }
      const binding = bindings.get(bindingKey(handle, incarnationId))
      return binding ? { ...binding } : undefined
    },
    snapshot() {
      return { revision, bindings: [...bindings.values()].map((binding) => ({ ...binding })) }
    }
  }
}

function bindingKey(terminalHandle: string, terminalIncarnationId: string): string {
  return `${terminalHandle}${KEY_SEPARATOR}${terminalIncarnationId}`
}

/** Rejects the key separator too, so no pair of identities can collide into one key. */
function normalizeIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  if (
    trimmed.length === 0 ||
    trimmed.length > AGENT_HOOK_BINDING_MAX_IDENTITY_LENGTH ||
    trimmed.includes(KEY_SEPARATOR)
  ) {
    return undefined
  }
  return trimmed
}

function resolveLaunchTokenHash(event: AgentHookBindingEvent): string | undefined {
  if (typeof event.launchTokenHash === 'string' && event.launchTokenHash.length > 0) {
    return event.launchTokenHash
  }
  return typeof event.launchToken === 'string' && event.launchToken.length > 0
    ? hashAgentLaunchToken(event.launchToken)
    : undefined
}

function isAgentStatusPayloadShape(payload: unknown): payload is ParsedAgentStatusPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }
  const { state, prompt } = payload as { state?: unknown; prompt?: unknown }
  return typeof state === 'string' && VALID_STATES.has(state) && typeof prompt === 'string'
}
