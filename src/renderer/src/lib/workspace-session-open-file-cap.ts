import type { PersistedOpenFile, WorkspaceSessionState } from '../../../shared/types'

/**
 * Restore-time bound on persisted editor tabs, per workspace.
 *
 * Why: `openFilesByWorktree` is append-only and never pruned, so it accumulates
 * across every restart. Crash bundles show sessions restoring 3,711 editor tabs
 * into one renderer. 100 is far above any real working set.
 */
export const MAX_RESTORED_OPEN_FILES_PER_WORKSPACE = 100

/**
 * Applied to the session once, before any slice hydrates it: the editor, tab and
 * tab-group slices all derive their state from `openFilesByWorktree`, so capping
 * it here keeps them consistent instead of leaving orphaned tabs behind.
 */
export function capRestoredOpenFilesByWorktree(
  session: WorkspaceSessionState
): WorkspaceSessionState {
  const openFilesByWorktree = session.openFilesByWorktree
  if (!openFilesByWorktree) {
    return session
  }

  let capped: Record<string, PersistedOpenFile[]> | null = null
  for (const [workspaceKey, files] of Object.entries(openFilesByWorktree)) {
    if (files.length <= MAX_RESTORED_OPEN_FILES_PER_WORKSPACE) {
      continue
    }
    capped ??= { ...openFilesByWorktree }
    capped[workspaceKey] = selectRestorableOpenFiles(
      files,
      session.activeFileIdByWorktree?.[workspaceKey]
    )
  }

  return capped ? { ...session, openFilesByWorktree: capped } : session
}

function selectRestorableOpenFiles(
  files: readonly PersistedOpenFile[],
  activeFileId: string | null | undefined
): PersistedOpenFile[] {
  const keep = new Set<number>()
  files.forEach((file, index) => {
    // Why: an unsaved draft is unrecoverable once dropped, and losing the tab the
    // user left focused is the one omission they would notice immediately.
    if (file.dirtyDraftContent !== undefined || addressesFile(activeFileId, file.filePath)) {
      keep.add(index)
    }
  })
  // Why: newly opened files are appended, so the tail is the most recent working set.
  for (
    let index = files.length - 1;
    index >= 0 && keep.size < MAX_RESTORED_OPEN_FILES_PER_WORKSPACE;
    index -= 1
  ) {
    keep.add(index)
  }
  return files.filter((_, index) => keep.has(index))
}

// Why: hydration keys a file either by its raw path or by an owner-qualified id
// whose final segment is the encoded path; both forms reach activeFileIdByWorktree.
function addressesFile(activeFileId: string | null | undefined, filePath: string): boolean {
  if (!activeFileId) {
    return false
  }
  return activeFileId === filePath || activeFileId.endsWith(`:${encodeURIComponent(filePath)}`)
}
