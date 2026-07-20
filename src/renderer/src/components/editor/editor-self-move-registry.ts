import { normalizeAbsolutePathForComparison } from '@/components/right-sidebar/file-explorer-paths'

// Why: an Orca-initiated move (explorer drag-drop, inline/tab rename) physically
// relocates a file, which the worktree watcher reports as delete(old) +
// create(new) a few ms later. The move also re-homes the open tab to the new
// path (remapOpenEditorTabsForPathChange) carrying its unsaved draft. Once the
// tab already lives at the new path, that create(new) echo looks — to
// useEditorExternalWatch — like an external write landing on a dirty tab, so it
// raises a false "changed on disk" banner whose Reload discards the draft.
// Stamping both endpoints of an Orca move (see recordSelfMoveForOpenTabs, called
// BEFORE the on-disk rename) lets the watch hook recognize the echo as
// self-initiated and skip the false conflict. This is the move analog of
// editor-self-write-registry (which covers content writes); matching is
// path-only because a move changes no content.
const SELF_MOVE_TTL_MS = 750
// Why: SSH/runtime watcher echoes travel a poll-plus-network path and can land
// seconds after the move. A local-sized TTL would expire before the remote echo
// arrives, re-opening the false-banner window on runtime-backed tabs.
export const SELF_MOVE_REMOTE_TTL_MS = 3000
// Why: sized well above any realistic count of simultaneously-open dirty tabs in
// one directory move (each moved tab stamps two distinct path keys), so a single
// bulk move never self-evicts its own not-yet-echoed stamps. Purely a safety
// valve — TTL pruning is the real bound, since stamps self-expire within seconds.
const SELF_MOVE_MAX_STAMPS = 1024

// Why: each stamp is one independent registration carrying its own expiry, held
// as a list per role. This keeps concurrent registrations of the same path+role
// (drag two files named report.md into one dir → both stamp that dir's
// report.md as a target) fully separate, so:
//  - a role is live while ANY of its registrations is unexpired,
//  - `clearSelfMove` retracts EXACTLY the registration a failed move added (by
//    its ticket's expiry), never a concurrent move's,
//  - an expired registration can't be "resurrected" by a later stamp on the
//    same key, because liveness is computed per registration, not from a shared
//    scalar. (A single shared expiry would over-extend the suppression window
//    when the max-contributing registration is cleared.)
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
 * Records an Orca-initiated move so the worktree-watch hook can recognize the
 * delete(old)+create(new) echo as self-initiated instead of an external change.
 * Both endpoints are stamped: the source so the delete does not tombstone the
 * tab, the target so the create does not raise a changed-on-disk banner on the
 * (re-homed, still-dirty) tab. Returns a ticket to retract this exact stamp with
 * {@link clearSelfMove} if the move turns out not to happen.
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

/**
 * Retracts exactly the registration a {@link recordSelfMove} added, so a rename
 * that FAILED after stamping does not keep suppressing genuine watcher events
 * for the paths it never moved. A concurrent move's registration on the same
 * path+role is untouched.
 */
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
