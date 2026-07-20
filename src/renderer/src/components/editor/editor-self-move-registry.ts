import { normalizeAbsolutePathForComparison } from '@/components/right-sidebar/file-explorer-paths'

// Records recent Orca-initiated moves so the watch hook knows a create/delete
// echo at a moved path may be the move's own, not an external write. Scopes WHEN
// to verify a target echo (see useEditorExternalWatch); source deletes are
// suppressed outright since a deletion can't be content-verified.
const SELF_MOVE_TTL_MS = 750
// SSH/runtime watcher echoes travel a poll-plus-network path and land later.
export const SELF_MOVE_REMOTE_TTL_MS = 3000
// Safety valve above any realistic bulk-move tab count; TTL pruning is the real bound.
const SELF_MOVE_MAX_STAMPS = 1024

// Each stamp is an independent registration with its own expiry (a list per
// role), so concurrent moves on the same path, precise ticket retraction, and
// expiry never interfere — a shared scalar expiry would over-extend or resurrect.
type SelfMoveStamp = {
  source: number[]
  target: number[]
}

/** A retraction handle for one recorded move — see {@link clearSelfMove}. */
export type SelfMoveTicket = {
  fromPath: string
  toPath: string
  runtimeEnvironmentId: string | null
  expiresAt: number
}

const stamps = new Map<string, SelfMoveStamp>()

function selfMoveKey(absolutePath: string, runtimeEnvironmentId?: string | null): string {
  return `${runtimeEnvironmentId?.trim() || 'client'}::${normalizeAbsolutePathForComparison(absolutePath)}`
}

function dropExpiredAndMaybeDelete(key: string, stamp: SelfMoveStamp, now: number): boolean {
  stamp.source = stamp.source.filter((expiresAt) => now <= expiresAt)
  stamp.target = stamp.target.filter((expiresAt) => now <= expiresAt)
  if (stamp.source.length === 0 && stamp.target.length === 0) {
    stamps.delete(key)
    return true
  }
  return false
}

function pruneExpiredSelfMoves(now: number): void {
  for (const [key, stamp] of stamps) {
    dropExpiredAndMaybeDelete(key, stamp, now)
  }
}

function enforceSelfMoveStampLimit(): void {
  while (stamps.size > SELF_MOVE_MAX_STAMPS) {
    const oldest = stamps.keys().next().value
    if (oldest === undefined) {
      break
    }
    stamps.delete(oldest)
  }
}

function pushRegistration(
  absolutePath: string,
  role: 'source' | 'target',
  runtimeEnvironmentId: string | null | undefined,
  expiresAt: number
): void {
  const key = selfMoveKey(absolutePath, runtimeEnvironmentId)
  const stamp = stamps.get(key) ?? { source: [], target: [] }
  stamp[role].push(expiresAt)
  // Why: delete+set keeps insertion recency fresh so the cap evicts genuinely
  // old stamps first.
  stamps.delete(key)
  stamps.set(key, stamp)
}

function removeRegistration(
  absolutePath: string,
  role: 'source' | 'target',
  runtimeEnvironmentId: string | null | undefined,
  expiresAt: number
): void {
  const key = selfMoveKey(absolutePath, runtimeEnvironmentId)
  const stamp = stamps.get(key)
  if (!stamp) {
    return
  }
  const index = stamp[role].indexOf(expiresAt)
  if (index >= 0) {
    stamp[role].splice(index, 1)
  }
  if (stamp.source.length === 0 && stamp.target.length === 0) {
    stamps.delete(key)
  }
}

/**
 * Stamps both endpoints of an Orca-initiated move. Returns a ticket to retract
 * this exact stamp with {@link clearSelfMove} if the move doesn't happen.
 */
export function recordSelfMove(
  fromPath: string,
  toPath: string,
  runtimeEnvironmentId?: string | null,
  ttlMs: number = SELF_MOVE_TTL_MS
): SelfMoveTicket {
  const now = Date.now()
  pruneExpiredSelfMoves(now)
  const expiresAt = now + ttlMs
  pushRegistration(fromPath, 'source', runtimeEnvironmentId, expiresAt)
  pushRegistration(toPath, 'target', runtimeEnvironmentId, expiresAt)
  enforceSelfMoveStampLimit()
  return { fromPath, toPath, runtimeEnvironmentId: runtimeEnvironmentId ?? null, expiresAt }
}

/** Retracts exactly the registration {@link recordSelfMove} added; leaves a
 * concurrent move's registration on the same path untouched. */
export function clearSelfMove(ticket: SelfMoveTicket): void {
  removeRegistration(ticket.fromPath, 'source', ticket.runtimeEnvironmentId, ticket.expiresAt)
  removeRegistration(ticket.toPath, 'target', ticket.runtimeEnvironmentId, ticket.expiresAt)
}

function hasLiveRole(
  absolutePath: string,
  role: 'source' | 'target',
  runtimeEnvironmentId?: string | null
): boolean {
  const key = selfMoveKey(absolutePath, runtimeEnvironmentId)
  const stamp = stamps.get(key)
  if (!stamp) {
    return false
  }
  const now = Date.now()
  const live = stamp[role].some((expiresAt) => now <= expiresAt)
  // Why: drop expired registrations on read so they can't be counted live and
  // don't linger until the next write's prune.
  dropExpiredAndMaybeDelete(key, stamp, now)
  return live
}

/** True when `path` is the destination of a recent Orca-initiated move. */
export function isRecentSelfMoveTarget(
  absolutePath: string,
  runtimeEnvironmentId?: string | null
): boolean {
  return hasLiveRole(absolutePath, 'target', runtimeEnvironmentId)
}

/** True when `path` is the origin of a recent Orca-initiated move. */
export function isRecentSelfMoveSource(
  absolutePath: string,
  runtimeEnvironmentId?: string | null
): boolean {
  return hasLiveRole(absolutePath, 'source', runtimeEnvironmentId)
}

export function __clearSelfMoveRegistryForTests(): void {
  stamps.clear()
}

export function __getSelfMoveRegistrySizeForTests(): number {
  return stamps.size
}
