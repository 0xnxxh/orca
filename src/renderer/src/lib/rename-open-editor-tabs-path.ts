import { renameRuntimePath, type RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'
import {
  clearSelfMoveForOpenTabs,
  recordSelfMoveForOpenTabs
} from './record-self-move-for-open-tabs'

/**
 * Renames a path on disk that may back open editor tabs, keeping the editor's
 * move-tracking correct so the watcher echo isn't mistaken for an external edit.
 *
 * Why the stamp is recorded both BEFORE and AFTER the rename:
 * - Before: the main-process watcher detects the physical move independently and
 *   can push its `fs:changed` event before this `await` resumes — the pre-stamp
 *   closes that race structurally instead of hoping to win it.
 * - After: the rename is an awaited round-trip that on a slow SSH/runtime host
 *   can outlive the stamp's TTL; re-stamping on success gives a fresh window
 *   that covers watcher latency measured from when the file actually moved.
 * On failure the stamps are cleared so a rename that never happened can't
 * suppress genuine events for the untouched paths.
 */
export async function renameOpenTabsPathOnDisk(
  context: RuntimeFileOperationArgs,
  fromPath: string,
  toPath: string
): Promise<void> {
  recordSelfMoveForOpenTabs(fromPath, toPath)
  try {
    await renameRuntimePath(context, fromPath, toPath)
  } catch (err) {
    clearSelfMoveForOpenTabs(fromPath, toPath)
    throw err
  }
  recordSelfMoveForOpenTabs(fromPath, toPath)
}
