import { normalizeAbsolutePathForComparison } from '@/components/right-sidebar/file-explorer-paths'

// Why: an Orca-initiated move (explorer drag-drop, inline/tab rename) physically
// relocates a file, which the worktree watcher reports as delete(old) +
// create(new) a few ms later. The move also re-homes the open tab to the new
// path (remapOpenEditorTabsForPathChange) carrying its unsaved draft. Once the
// tab already lives at the new path, that create(new) echo looks — to
// useEditorExternalWatch — like an external write landing on a dirty tab, so it
// raises a false "changed on disk" banner whose Reload discards the draft.
// Stamping both endpoints of an Orca move right before the remap lets the watch
// hook recognize the echo as self-initiated and skip the false conflict. This is
// the move analog of editor-self-write-registry (which covers content writes);
// matching is path-only because a move changes no content.
const SELF_MOVE_TTL_MS = 750
// Why: SSH/runtime watcher echoes travel a poll-plus-network path and can land
// seconds after the move. A local-sized TTL would expire before the remote echo
// arrives, re-opening the false-banner window on runtime-backed tabs.
export const SELF_MOVE_REMOTE_TTL_MS = 3000
const SELF_MOVE_MAX_STAMPS = 256

type SelfMoveDirection = 'source' | 'target'

type SelfMoveStamp = {
  direction: SelfMoveDirection
  expiresAt: number
}

const stamps = new Map<string, SelfMoveStamp>()

function selfMoveKey(absolutePath: string, runtimeEnvironmentId?: string | null): string {
  return `${runtimeEnvironmentId?.trim() || 'client'}::${normalizeAbsolutePathForComparison(absolutePath)}`
}

function pruneExpiredSelfMoves(now: number): void {
  for (const [key, stamp] of stamps) {
    if (now > stamp.expiresAt) {
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

function stampSelfMoveEndpoint(
  absolutePath: string,
  direction: SelfMoveDirection,
  runtimeEnvironmentId: string | null | undefined,
  expiresAt: number
): void {
  const key = selfMoveKey(absolutePath, runtimeEnvironmentId)
  stamps.delete(key)
  stamps.set(key, { direction, expiresAt })
}

/**
 * Records an Orca-initiated move so the worktree-watch hook can recognize the
 * delete(old)+create(new) echo as self-initiated instead of an external change.
 * Both endpoints are stamped: the source so a pre-remap delete does not tombstone
 * the tab, the target so the post-remap create does not raise a changed-on-disk
 * banner on the (already re-homed, still-dirty) tab.
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
  stampSelfMoveEndpoint(fromPath, 'source', runtimeEnvironmentId, expiresAt)
  stampSelfMoveEndpoint(toPath, 'target', runtimeEnvironmentId, expiresAt)
  enforceSelfMoveStampLimit()
}

function hasRecentSelfMove(
  absolutePath: string,
  direction: SelfMoveDirection,
  runtimeEnvironmentId?: string | null
): boolean {
  const key = selfMoveKey(absolutePath, runtimeEnvironmentId)
  const stamp = stamps.get(key)
  if (!stamp) {
    return false
  }
  if (Date.now() > stamp.expiresAt) {
    stamps.delete(key)
    return false
  }
  return stamp.direction === direction
}

/** True when `path` is the destination of a recent Orca-initiated move. */
export function isRecentSelfMoveTarget(
  absolutePath: string,
  runtimeEnvironmentId?: string | null
): boolean {
  return hasRecentSelfMove(absolutePath, 'target', runtimeEnvironmentId)
}

/** True when `path` is the origin of a recent Orca-initiated move. */
export function isRecentSelfMoveSource(
  absolutePath: string,
  runtimeEnvironmentId?: string | null
): boolean {
  return hasRecentSelfMove(absolutePath, 'source', runtimeEnvironmentId)
}

export function __clearSelfMoveRegistryForTests(): void {
  stamps.clear()
}

export function __getSelfMoveRegistrySizeForTests(): number {
  return stamps.size
}
