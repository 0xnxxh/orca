import { useAppStore } from '@/store'
import {
  recordSelfMove,
  SELF_MOVE_REMOTE_TTL_MS
} from '@/components/editor/editor-self-move-registry'
import { isPathInsideOrEqual } from './remap-open-editor-tabs-for-path-change'

/**
 * Stamps every open editor tab affected by an Orca-initiated move so the
 * worktree watcher's delete(old)+create(new) echo is recognized as
 * self-initiated (see editor-self-move-registry).
 *
 * Why: this MUST run BEFORE the on-disk `renameRuntimePath`, not after the tab
 * re-home in remapOpenEditorTabsForPathChange. The main-process watcher detects
 * the physical move independently and can push its `fs:changed` event before the
 * renderer resumes past the rename `await`; stamping first closes that window
 * structurally instead of racing it. Mirror the caller's own affected-tab
 * predicate (isPathInsideOrEqual) and the remap's absolute-path suffix swap so a
 * directory move stamps each contained tab's real new path.
 */
export function recordSelfMoveForOpenTabs(fromPath: string, toPath: string): void {
  for (const file of useAppStore.getState().openFiles) {
    if (!isPathInsideOrEqual(fromPath, file.filePath)) {
      continue
    }
    const newFilePath = toPath + file.filePath.slice(fromPath.length)
    // Why: runtime-backed tabs use the longer remote TTL because their watcher
    // echo travels a poll-plus-network path and lands later than a local one.
    const runtimeOwner = file.runtimeEnvironmentId?.trim() || null
    recordSelfMove(
      file.filePath,
      newFilePath,
      runtimeOwner,
      runtimeOwner ? SELF_MOVE_REMOTE_TTL_MS : undefined
    )
  }
}
