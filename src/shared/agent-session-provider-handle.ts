/**
 * Durable provider handle chain for an agent session.
 *
 * Handles are keyed per provider because the two structured lanes disagree about what
 * identifies a conversation: a Claude session id alone can name two sibling branches inside one
 * transcript, so the leaf uuid is part of the key; a Codex thread id is the whole key. Resumes
 * extend the chain, forks start a new identity root, and the chain records which is which so a
 * fork is never presented as a resume.
 */

export const AGENT_SESSION_PROVIDER_HANDLE_PROVIDERS = ['claude', 'codex'] as const

export type AgentSessionHandleProvider = (typeof AGENT_SESSION_PROVIDER_HANDLE_PROVIDERS)[number]

export type AgentSessionProviderHandle =
  | { provider: 'claude'; sessionId: string; leafUuid: string | null }
  | { provider: 'codex'; threadId: string }

export type AgentSessionProviderHandleOrigin = 'created' | 'adopted' | 'resumed' | 'forked'

export type AgentSessionProviderHandleLink = {
  /** Stable id so a lease can name the exact link its owner proved. */
  linkId: string
  handle: AgentSessionProviderHandle
  origin: AgentSessionProviderHandleOrigin
  /** Runtime fence in force when this link was minted; never decreases along the chain. */
  mintedAtFence: number
  observedAt: number
  /** Key of the link a fork was seeded from. Only set when `origin` is `forked`. */
  forkedFromKey?: string
}

export type AgentSessionProviderHandleChain = readonly AgentSessionProviderHandleLink[]

/** Bounded so one session cannot grow an unbounded persisted record. */
export const MAX_AGENT_SESSION_PROVIDER_HANDLE_LINKS = 256

const MAX_HANDLE_FIELD_LENGTH = 512
const LINK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

function isHandleField(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_HANDLE_FIELD_LENGTH &&
    value === value.trim()
  )
}

export function isAgentSessionProviderHandle(value: unknown): value is AgentSessionProviderHandle {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const handle = value as Partial<AgentSessionProviderHandle> & Record<string, unknown>
  if (handle.provider === 'claude') {
    return (
      isHandleField(handle.sessionId) &&
      (handle.leafUuid === null || isHandleField(handle.leafUuid))
    )
  }
  return handle.provider === 'codex' && isHandleField(handle.threadId)
}

/** Stable string identity for one handle. Two handles with the same key name the same writer target. */
export function agentSessionProviderHandleKey(handle: AgentSessionProviderHandle): string {
  return handle.provider === 'claude'
    ? `claude:${handle.sessionId}#${handle.leafUuid ?? ''}`
    : `codex:${handle.threadId}`
}

/**
 * Identity root: the part that a resume must preserve. A resume that changes the root is a fork,
 * whatever the provider called it.
 */
export function agentSessionProviderHandleRoot(handle: AgentSessionProviderHandle): string {
  return handle.provider === 'claude' ? `claude:${handle.sessionId}` : `codex:${handle.threadId}`
}

export function agentSessionProviderHandlesEqual(
  left: AgentSessionProviderHandle,
  right: AgentSessionProviderHandle
): boolean {
  return agentSessionProviderHandleKey(left) === agentSessionProviderHandleKey(right)
}

export function agentSessionProviderHandleChainHead(
  chain: AgentSessionProviderHandleChain
): AgentSessionProviderHandleLink | null {
  return chain.at(-1) ?? null
}

export function findAgentSessionProviderHandleLink(
  chain: AgentSessionProviderHandleChain,
  linkId: string
): AgentSessionProviderHandleLink | null {
  return chain.find((link) => link.linkId === linkId) ?? null
}

export function isAgentSessionProviderHandleLink(
  value: unknown
): value is AgentSessionProviderHandleLink {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const link = value as Partial<AgentSessionProviderHandleLink>
  return (
    typeof link.linkId === 'string' &&
    LINK_ID_PATTERN.test(link.linkId) &&
    isAgentSessionProviderHandle(link.handle) &&
    (link.origin === 'created' ||
      link.origin === 'adopted' ||
      link.origin === 'resumed' ||
      link.origin === 'forked') &&
    Number.isSafeInteger(link.mintedAtFence) &&
    (link.mintedAtFence as number) >= 0 &&
    Number.isSafeInteger(link.observedAt) &&
    (link.forkedFromKey === undefined || isHandleField(link.forkedFromKey))
  )
}

export function isAgentSessionProviderHandleChain(
  value: unknown
): value is AgentSessionProviderHandleLink[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_AGENT_SESSION_PROVIDER_HANDLE_LINKS &&
    value.every((link) => isAgentSessionProviderHandleLink(link))
  )
}

/**
 * Append one link, rejecting anything that would let a fork masquerade as a resume or let a
 * late writer rewrite the chain under an older fence.
 */
export function appendAgentSessionProviderHandleLink(
  chain: AgentSessionProviderHandleChain,
  link: AgentSessionProviderHandleLink
): AgentSessionProviderHandleLink[] {
  if (!isAgentSessionProviderHandleLink(link)) {
    throw new Error('agent_session_provider_handle_invalid')
  }
  const head = agentSessionProviderHandleChainHead(chain)
  if (!head) {
    if (link.origin !== 'created' && link.origin !== 'adopted') {
      throw new Error('agent_session_provider_handle_invalid')
    }
    return [link]
  }
  if (link.handle.provider !== head.handle.provider) {
    throw new Error('agent_session_provider_handle_provider_mismatch')
  }
  if (link.mintedAtFence < head.mintedAtFence) {
    throw new Error('agent_session_provider_handle_stale_fence')
  }
  if (link.origin === 'created' || link.origin === 'adopted') {
    throw new Error('agent_session_provider_handle_invalid')
  }
  const sameRoot =
    agentSessionProviderHandleRoot(link.handle) === agentSessionProviderHandleRoot(head.handle)
  if (link.origin === 'resumed' && !sameRoot) {
    // Why: a resume that lands on another identity root forked; recording it as a resume would
    // make Orca claim continuity the provider never gave.
    throw new Error('agent_session_provider_handle_forked')
  }
  if (link.origin === 'forked') {
    if (sameRoot) {
      throw new Error('agent_session_provider_handle_invalid')
    }
    if (link.forkedFromKey !== agentSessionProviderHandleKey(head.handle)) {
      throw new Error('agent_session_provider_handle_invalid')
    }
  }
  if (
    link.origin === 'resumed' &&
    agentSessionProviderHandlesEqual(link.handle, head.handle) &&
    link.mintedAtFence === head.mintedAtFence
  ) {
    // Why: re-proving the same handle at the same fence is a retry, not a new identity.
    return [...chain]
  }
  if (chain.length >= MAX_AGENT_SESSION_PROVIDER_HANDLE_LINKS) {
    // Why: dropping older links would erase fork provenance, so refuse and let the caller roll
    // the journal epoch instead of silently losing where this conversation came from.
    throw new Error('agent_session_provider_handle_chain_overflow')
  }
  return [...chain, link]
}
