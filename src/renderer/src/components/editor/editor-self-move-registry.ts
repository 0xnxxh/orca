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
// B→A leaves A as a live source (of the first move, whose delayed watcher echo
// may still be in flight) and a live target (of the undo). Storing one mutable
// direction per path would let the undo clobber the first move's source stamp
// and re-expose the original echo. Track the two roles' expiries independently.
type SelfMoveStamp = {
  sourceExpiresAt: number
  targetExpiresAt: number
}

const stamps = new Map<string, SelfMoveStamp>()

function selfMoveKey(absolutePath: string, runtimeEnvironmentId?: string | null): string {
  return `${runtimeEnvironmentId?.trim() || 'client'}::${normalizeAbsolutePathForComparison(absolutePath)}`
}

function pruneExpiredSelfMoves(now: number): void {
  for (const [key, stamp] of stamps) {
    if (now > stamp.sourceExpiresAt && now > stamp.targetExpiresAt) {
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

function stampRole(
  absolutePath: string,
  role: 'source' | 'target',
  runtimeEnvironmentId: string | null | undefined,
  expiresAt: number
): void {
  const key = selfMoveKey(absolutePath, runtimeEnvironmentId)
  const existing = stamps.get(key)
  // Why: keep insertion recency fresh (delete+set) so the cap evicts genuinely
  // old stamps first, and merge rather than overwrite so the untouched role of a
  // concurrent move on the same path survives.
  const next: SelfMoveStamp = existing
    ? { ...existing }
    : { sourceExpiresAt: 0, targetExpiresAt: 0 }
  if (role === 'source') {
    next.sourceExpiresAt = Math.max(next.sourceExpiresAt, expiresAt)
  } else {
    next.targetExpiresAt = Math.max(next.targetExpiresAt, expiresAt)
  }
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
  const expiresAt = role === 'source' ? stamp.sourceExpiresAt : stamp.targetExpiresAt
  if (now > expiresAt) {
    // Why: drop the whole entry only once both roles have expired.
    if (now > stamp.sourceExpiresAt && now > stamp.targetExpiresAt) {
      stamps.delete(key)
    }
    return false
  }
  return true
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
  const existing = stamps.get(key)
  if (!existing) {
    return
  }
  const next: SelfMoveStamp =
    role === 'source' ? { ...existing, sourceExpiresAt: 0 } : { ...existing, targetExpiresAt: 0 }
  if (next.sourceExpiresAt === 0 && next.targetExpiresAt === 0) {
    stamps.delete(key)
  } else {
    stamps.set(key, next)
  }
}

/**
 * Drops the source/target roles a move stamped, so a rename that FAILED after
 * stamping does not keep suppressing genuine watcher events for the paths it
 * never actually moved. Only the two roles this move added are cleared, so a
 * concurrent move touching the same path keeps its own role.
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
