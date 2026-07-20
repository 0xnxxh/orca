import { renameRuntimePath, type RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'
import {
  clearSelfMoveForOpenTabs,
  recordSelfMoveForOpenTabs
} from './record-self-move-for-open-tabs'

/**
 * Renames an on-disk path that may back open editor tabs, stamping the move so
 * the watcher echo isn't mistaken for an external edit. Stamp BEFORE the rename
 * (the watcher can fire before this `await` resumes), re-stamp on success (a slow
 * remote rename can outlive the first TTL), and retract on failure.
 */
export async function renameOpenTabsPathOnDisk(
  context: RuntimeFileOperationArgs,
  fromPath: string,
  toPath: string
): Promise<void> {
  const pendingTickets = recordSelfMoveForOpenTabs(fromPath, toPath)
  try {
    await renameRuntimePath(context, fromPath, toPath)
  } catch (err) {
    clearSelfMoveForOpenTabs(pendingTickets)
    throw err
  }
  recordSelfMoveForOpenTabs(fromPath, toPath)
}
