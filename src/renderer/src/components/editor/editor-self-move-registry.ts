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

// Why: a path can hold BOTH roles at once — e.g. move A→B then immediately undo
// B→A leaves A a live source (of the first move, whose delayed watcher echo may
// still be in flight) and a live target (of the undo) — and it can hold the SAME
// role from two concurrent moves (drag two files named report.md into one dir →
// both stamp that dir's report.md as a target). So each role is reference
// counted: a role is live while any un-cleared registration remains and its
// expiry is in the future. Refcounting lets a FAILED move's clear drop only its
// own registration instead of erasing a concurrent successful move's stamp.
type RoleState = {
  refs: number
  expiresAt: number
}

type SelfMoveStamp = {
  source: RoleState
  target: RoleState
}

const stamps = new Map<string, SelfMoveStamp>()

function selfMoveKey(absolutePath: string, runtimeEnvironmentId?: string | null): string {
  return `${runtimeEnvironmentId?.trim() || 'client'}::${normalizeAbsolutePathForComparison(absolutePath)}`
}

function isRoleLive(state: RoleState, now: number): boolean {
  return state.refs > 0 && now <= state.expiresAt
}

function pruneExpiredSelfMoves(now: number): void {
  for (const [key, stamp] of stamps) {
    if (!isRoleLive(stamp.source, now) && !isRoleLive(stamp.target, now)) {
      stamps.delete(key)
    }
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

function emptyStamp(): SelfMoveStamp {
  return { source: { refs: 0, expiresAt: 0 }, target: { refs: 0, expiresAt: 0 } }
}

function stampRole(
  absolutePath: string,
  role: 'source' | 'target',
  runtimeEnvironmentId: string | null | undefined,
  expiresAt: number
): void {
  const key = selfMoveKey(absolutePath, runtimeEnvironmentId)
  const next = stamps.get(key) ?? emptyStamp()
  const state = next[role]
  state.refs += 1
  state.expiresAt = Math.max(state.expiresAt, expiresAt)
  // Why: delete+set keeps insertion recency fresh so the cap evicts genuinely
  // old stamps first.
  stamps.delete(key)
  stamps.set(key, next)
}

/**
 * Records an Orca-initiated move so the worktree-watch hook can recognize the
 * delete(old)+create(new) echo as self-initiated instead of an external change.
 * Both endpoints are stamped: the source so the delete does not tombstone the
 * tab, the target so the create does not raise a changed-on-disk banner on the
 * (re-homed, still-dirty) tab.
 */
export function recordSelfMove(
  fromPath: string,
  toPath: string,
  runtimeEnvironmentId?: string | null,
  ttlMs: number = SELF_MOVE_TTL_MS
): void {
  const now = Date.now()
  pruneExpiredSelfMoves(now)
  const expiresAt = now + ttlMs
  stampRole(fromPath, 'source', runtimeEnvironmentId, expiresAt)
  stampRole(toPath, 'target', runtimeEnvironmentId, expiresAt)
  enforceSelfMoveStampLimit()
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
  const live = isRoleLive(stamp[role], now)
  // Why: drop the whole entry once neither role is live so expired stamps don't
  // linger until the next write's prune.
  if (!isRoleLive(stamp.source, now) && !isRoleLive(stamp.target, now)) {
    stamps.delete(key)
  }
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

function clearRole(
  absolutePath: string,
  role: 'source' | 'target',
  runtimeEnvironmentId: string | null | undefined
): void {
  const key = selfMoveKey(absolutePath, runtimeEnvironmentId)
  const stamp = stamps.get(key)
  if (!stamp) {
    return
  }
  const state = stamp[role]
  // Why: drop only THIS move's registration (one ref). A concurrent move that
  // stamped the same role keeps the role live via its own ref.
  state.refs = Math.max(0, state.refs - 1)
  if (state.refs === 0) {
    state.expiresAt = 0
  }
  const now = Date.now()
  if (!isRoleLive(stamp.source, now) && !isRoleLive(stamp.target, now)) {
    stamps.delete(key)
  }
}

/**
 * Drops one registration of the roles a move stamped, so a rename that FAILED
 * after stamping does not keep suppressing genuine watcher events for the paths
 * it never actually moved. Reference counted, so a concurrent move that stamped
 * the same role keeps that role live.
 */
export function clearSelfMove(
  fromPath: string,
  toPath: string,
  runtimeEnvironmentId?: string | null
): void {
  clearRole(fromPath, 'source', runtimeEnvironmentId)
  clearRole(toPath, 'target', runtimeEnvironmentId)
}

export function __clearSelfMoveRegistryForTests(): void {
  stamps.clear()
}

export function __getSelfMoveRegistrySizeForTests(): number {
  return stamps.size
}
