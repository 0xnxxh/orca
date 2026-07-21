import { normalizeAbsolutePathForComparison } from '@/components/right-sidebar/file-explorer-paths'

// Tracks Orca-owned moves that are in flight (rename issued, not yet settled).
// Replaces the old time-bounded self-move registry: an operation is live only
// for the exact duration of its filesystem rename + atomic rekey, so there is
// no TTL to race a slow SSH rename and no cross-operation aliasing.
//
// Only the source side needs this: while an operation is live, a watcher delete
// of anything under one of its source ROOTS is the move's own echo, not an
// external delete — don't tombstone. Roots are prefix-matched (not exact) so a
// file opened UNDER a moving directory mid-rename is covered too. The
// destination is handled after commit: the coordinator proactively
// content-verifies every gated moved tab.

type MoveOperation = {
  worktreeId: string
  runtimeEnvironmentId: string | null
  sourceRoots: string[]
}

const operations = new Map<string, MoveOperation>()

function owner(runtimeEnvironmentId: string | null | undefined): string | null {
  return runtimeEnvironmentId?.trim() || null
}

function normalize(absolutePath: string): string {
  return normalizeAbsolutePathForComparison(absolutePath)
}

// Both sides are normalized (separators folded, trailing slash trimmed), so a
// single-separator prefix check is exact.
function isInsideOrEqual(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`)
}

export function beginEditorPathMove(args: {
  operationId: string
  worktreeId: string
  runtimeEnvironmentId: string | null | undefined
  /** Move roots (fromPath); a delete under any of them is suppressed. */
  sourcePaths: readonly string[]
}): void {
  operations.set(args.operationId, {
    worktreeId: args.worktreeId,
    runtimeEnvironmentId: owner(args.runtimeEnvironmentId),
    sourceRoots: args.sourcePaths.map(normalize)
  })
}

export function settleEditorPathMove(operationId: string): void {
  operations.delete(operationId)
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
    if (operation.worktreeId !== worktreeId || operation.runtimeEnvironmentId !== scopedOwner) {
      continue
    }
    if (operation.sourceRoots.some((root) => isInsideOrEqual(root, normalizedPath))) {
      return true
    }
  }
  return false
}

export function __clearEditorPathMovesForTests(): void {
  operations.clear()
}

export function __activeEditorPathMoveCountForTests(): number {
  return operations.size
}
