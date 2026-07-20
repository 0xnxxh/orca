import { useAppStore } from '@/store'
import { getConnectionIdForFile } from '@/lib/connection-context'
import {
  clearSelfMove,
  recordSelfMove,
  SELF_MOVE_REMOTE_TTL_MS,
  type SelfMoveTicket
} from '@/components/editor/editor-self-move-registry'
import { isPathInsideOrEqual } from './remap-open-editor-tabs-for-path-change'
import type { OpenFile } from '@/store/slices/editor'

type OpenTabMove = {
  file: OpenFile
  newFilePath: string
  runtimeOwner: string | null
  ttlMs: number | undefined
}

function collectOpenTabMoves(fromPath: string, toPath: string): OpenTabMove[] {
  const moves: OpenTabMove[] = []
  for (const file of useAppStore.getState().openFiles) {
    if (!isPathInsideOrEqual(fromPath, file.filePath)) {
      continue
    }
    const runtimeOwner = file.runtimeEnvironmentId?.trim() || null
    // Remote via runtime owner OR an SSH worktree connection (an SSH tab can have
    // a null runtime owner); both take a later poll-plus-network watcher echo.
    const isRemote =
      runtimeOwner !== null || !!getConnectionIdForFile(file.worktreeId, file.filePath)
    moves.push({
      file,
      // Mirror remap's suffix swap so a directory move stamps each tab's new path.
      newFilePath: toPath + file.filePath.slice(fromPath.length),
      runtimeOwner,
      ttlMs: isRemote ? SELF_MOVE_REMOTE_TTL_MS : undefined
    })
  }
  return moves
}

/** Stamps every open tab a move affects. Prefer `renameOpenTabsPathOnDisk`,
 * which brackets the rename with the stamps; exported for it and tests. */
export function recordSelfMoveForOpenTabs(fromPath: string, toPath: string): SelfMoveTicket[] {
  return collectOpenTabMoves(fromPath, toPath).map((move) =>
    recordSelfMove(move.file.filePath, move.newFilePath, move.runtimeOwner, move.ttlMs)
  )
}

/** Retracts the exact registrations {@link recordSelfMoveForOpenTabs} returned. */
export function clearSelfMoveForOpenTabs(tickets: SelfMoveTicket[]): void {
  for (const ticket of tickets) {
    clearSelfMove(ticket)
  }
}
