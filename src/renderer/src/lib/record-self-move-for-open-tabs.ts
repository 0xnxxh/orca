import { useAppStore } from '@/store'
import { getConnectionIdForFile } from '@/lib/connection-context'
import {
  clearSelfMove,
  recordSelfMove,
  SELF_MOVE_REMOTE_TTL_MS
} from '@/components/editor/editor-self-move-registry'
import { isPathInsideOrEqual } from './remap-open-editor-tabs-for-path-change'
import type { OpenFile } from '@/store/slices/editor'

type OpenTabMove = {
  file: OpenFile
  newFilePath: string
  runtimeOwner: string | null
  ttlMs: number | undefined
}

// Why: runtime-backed AND SSH-connected tabs both take a watcher echo on a
// poll-plus-network path that lands later than a local one, so both need the
// longer remote TTL. An SSH tab can carry runtimeEnvironmentId=null yet still be
// remote via its worktree connection, so key remoteness off either signal.
function collectOpenTabMoves(fromPath: string, toPath: string): OpenTabMove[] {
  const moves: OpenTabMove[] = []
  for (const file of useAppStore.getState().openFiles) {
    if (!isPathInsideOrEqual(fromPath, file.filePath)) {
      continue
    }
    const runtimeOwner = file.runtimeEnvironmentId?.trim() || null
    const isRemote =
      runtimeOwner !== null || !!getConnectionIdForFile(file.worktreeId, file.filePath)
    moves.push({
      file,
      // Mirror remap's absolute-path suffix swap so a directory move stamps each
      // contained tab's real new path.
      newFilePath: toPath + file.filePath.slice(fromPath.length),
      runtimeOwner,
      ttlMs: isRemote ? SELF_MOVE_REMOTE_TTL_MS : undefined
    })
  }
  return moves
}

/**
 * Stamps every open editor tab affected by an Orca-initiated move so the
 * worktree watcher's delete(old)+create(new) echo is recognized as
 * self-initiated (see editor-self-move-registry).
 *
 * Prefer `renameOpenTabsPathOnDisk`, which brackets the on-disk rename with the
 * before/after stamps and the failure clear. This is exported for that wrapper
 * (and tests); call it directly only when you own the rename lifecycle.
 */
export function recordSelfMoveForOpenTabs(fromPath: string, toPath: string): void {
  for (const move of collectOpenTabMoves(fromPath, toPath)) {
    recordSelfMove(move.file.filePath, move.newFilePath, move.runtimeOwner, move.ttlMs)
  }
}

/** Undoes {@link recordSelfMoveForOpenTabs} for a move that did not happen. */
export function clearSelfMoveForOpenTabs(fromPath: string, toPath: string): void {
  for (const move of collectOpenTabMoves(fromPath, toPath)) {
    clearSelfMove(move.file.filePath, move.newFilePath, move.runtimeOwner)
  }
}
