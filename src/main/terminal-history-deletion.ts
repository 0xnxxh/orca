import { basename, join } from 'node:path'
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import {
  getHistoryRoot,
  hashWorktreeId,
  listWslHistoryRoots,
  PENDING_DELETE_DIR_NAME
} from './terminal-history-paths'

const pendingHistoryTreeRemovals = new Map<string, Promise<void>>()

function getPendingDeleteRoot(historyRoot: string): string {
  return join(historyRoot, PENDING_DELETE_DIR_NAME)
}

/** Move a history tree to a pending-delete tombstone (metadata-only) so the critical path never walks it. */
function tombstoneHistoryTree(dir: string, historyRoot: string): string | null {
  if (!existsSync(dir)) {
    return null
  }
  const pendingRoot = getPendingDeleteRoot(historyRoot)
  try {
    if (!existsSync(pendingRoot)) {
      mkdirSync(pendingRoot, { recursive: true })
    }
    const tombstone = join(
      pendingRoot,
      `${basename(dir)}.${Date.now()}.${Math.random().toString(16).slice(2)}`
    )
    renameSync(dir, tombstone)
    return tombstone
  } catch (err) {
    console.warn(
      `[pty:history] Failed to tombstone history dir: ${err instanceof Error ? err.message : String(err)}`
    )
    // Why: never schedule an async rm of the live path — worktree IDs are path-derived, so a recreated
    // worktree can own this directory again before the rm lands. GC reclaims it by meta.worktreeId instead.
    return null
  }
}

function scheduleHistoryTreeRemoval(dir: string): void {
  if (pendingHistoryTreeRemovals.has(dir)) {
    return
  }
  const removal = rm(dir, { recursive: true, force: true })
    .catch((err: unknown) => {
      console.warn(
        `[pty:history] Failed to delete history dir: ${err instanceof Error ? err.message : String(err)}`
      )
    })
    .finally(() => {
      if (pendingHistoryTreeRemovals.get(dir) === removal) {
        pendingHistoryTreeRemovals.delete(dir)
      }
    })
  pendingHistoryTreeRemovals.set(dir, removal)
}

/** Schedule tombstoned trees under one history root for async removal — the retry after a quit mid-rm. */
export function schedulePendingHistoryTreeRemovals(historyRoot: string): void {
  const pendingRoot = getPendingDeleteRoot(historyRoot)
  if (!existsSync(pendingRoot)) {
    return
  }
  try {
    for (const entry of readdirSync(pendingRoot)) {
      scheduleHistoryTreeRemoval(join(pendingRoot, entry))
    }
  } catch {
    // Non-fatal.
  }
}

/** Drain every history root's tombstones and await the in-flight removals. Tests only: production
 *  schedules the same drain from startup GC and headless serve without ever blocking on it. */
export async function flushPendingWorktreeHistoryDeletions(): Promise<void> {
  schedulePendingHistoryTreeRemovals(getHistoryRoot())
  for (const distroRoot of listWslHistoryRoots()) {
    schedulePendingHistoryTreeRemovals(distroRoot)
  }
  await Promise.all(pendingHistoryTreeRemovals.values())
}

/** Delete the history directory for a removed worktree. Non-fatal; never blocks on recursive rm. */
export function deleteWorktreeHistoryDir(worktreeId: string): void {
  const worktreeHash = hashWorktreeId(worktreeId)
  const historyRoot = getHistoryRoot()
  try {
    const tombstone = tombstoneHistoryTree(join(historyRoot, worktreeHash), historyRoot)
    if (tombstone) {
      scheduleHistoryTreeRemoval(tombstone)
      console.log(`[pty:history] Scheduled history delete for worktree ${worktreeId}`)
    }
  } catch (err) {
    console.warn(
      `[pty:history] Failed to schedule history delete: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  // Also clean up WSL history for this worktree; listWslHistoryRoots is empty where WSL never ran.
  for (const distroRoot of listWslHistoryRoots()) {
    const tombstone = tombstoneHistoryTree(join(distroRoot, worktreeHash), distroRoot)
    if (tombstone) {
      scheduleHistoryTreeRemoval(tombstone)
    }
  }
}
