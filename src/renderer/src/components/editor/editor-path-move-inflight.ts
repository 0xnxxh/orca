import { normalizeAbsolutePathForComparison } from '@/components/right-sidebar/file-explorer-paths'

// Tracks Orca-owned moves that are in flight (rename issued, not yet settled).
// Replaces the old time-bounded self-move registry: an operation is live only
// for the exact duration of its filesystem rename + atomic rekey, so there is
// no TTL to race a slow SSH rename and no cross-operation aliasing.
//
// Source side: while an operation is live, a watcher delete of one of its exact
// source paths is the move's own echo, not an external delete — don't tombstone.
// Destination side: a create/update at a target path may be the move's echo but
// may also be a concurrent external write; the operation only LATCHES that such
// an event was seen (before the rekey installs the tab) so the coordinator can
// route it into content verification after commit — the latch never suppresses.

type MoveOperation = {
  operationId: string
  worktreeId: string
  runtimeEnvironmentId: string | null
  sourcePaths: Set<string>
  targetPaths: Set<string>
  destinationSeen: Set<string>
}

const operations = new Map<string, MoveOperation>()

function owner(runtimeEnvironmentId: string | null | undefined): string | null {
  return runtimeEnvironmentId?.trim() || null
}

function normalize(absolutePath: string): string {
  return normalizeAbsolutePathForComparison(absolutePath)
}

export function beginEditorPathMove(args: {
  operationId: string
  worktreeId: string
  runtimeEnvironmentId: string | null | undefined
  sourcePaths: readonly string[]
  targetPaths: readonly string[]
}): void {
  operations.set(args.operationId, {
    operationId: args.operationId,
    worktreeId: args.worktreeId,
    runtimeEnvironmentId: owner(args.runtimeEnvironmentId),
    sourcePaths: new Set(args.sourcePaths.map(normalize)),
    targetPaths: new Set(args.targetPaths.map(normalize)),
    destinationSeen: new Set()
  })
}

/** Removes the operation and returns the target paths whose destination event
 * was latched while in flight, so the coordinator can verify them post-rekey. */
export function settleEditorPathMove(operationId: string): string[] {
  const operation = operations.get(operationId)
  operations.delete(operationId)
  return operation ? Array.from(operation.destinationSeen) : []
}

function matches(
  operation: MoveOperation,
  worktreeId: string,
  runtimeEnvironmentId: string | null,
  normalizedPath: string,
  paths: Set<string>
): boolean {
  return (
    operation.worktreeId === worktreeId &&
    operation.runtimeEnvironmentId === runtimeEnvironmentId &&
    paths.has(normalizedPath)
  )
}

/** True when this delete is the source side of a live Orca-owned move. */
export function isActiveMoveSourcePath(
  worktreeId: string,
  runtimeEnvironmentId: string | null | undefined,
  absolutePath: string
): boolean {
  const normalizedPath = normalize(absolutePath)
  const scopedOwner = owner(runtimeEnvironmentId)
  for (const operation of operations.values()) {
    if (matches(operation, worktreeId, scopedOwner, normalizedPath, operation.sourcePaths)) {
      return true
    }
  }
  return false
}

/** Latch that a destination event was observed for a live move (used when the
 * event arrives before the atomic rekey installs the tab). Returns true if it
 * belonged to a live move. Never suppresses on its own. */
export function noteEditorPathMoveDestinationEvent(
  worktreeId: string,
  runtimeEnvironmentId: string | null | undefined,
  absolutePath: string
): boolean {
  const normalizedPath = normalize(absolutePath)
  const scopedOwner = owner(runtimeEnvironmentId)
  let latched = false
  for (const operation of operations.values()) {
    if (matches(operation, worktreeId, scopedOwner, normalizedPath, operation.targetPaths)) {
      operation.destinationSeen.add(normalizedPath)
      latched = true
    }
  }
  return latched
}

export function __clearEditorPathMovesForTests(): void {
  operations.clear()
}

export function __activeEditorPathMoveCountForTests(): number {
  return operations.size
}
