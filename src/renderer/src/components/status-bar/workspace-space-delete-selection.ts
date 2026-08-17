import type { WorkspaceSpaceWorktree } from '../../../../shared/workspace-space-types'

/**
 * Which Space rows a delete action applies to.
 *
 * Rows are host-partitioned: two rows can share a `repoId::path` worktree id
 * when the same repo is registered on two execution hosts. Anything feeding a
 * destructive action therefore hands back ROWS, not ids — an id alone cannot say
 * which host's checkout the user pointed at (STA-4343).
 */

/** The selected rows themselves — each keeps its own host (STA-4343). */
export function getSelectedDeletableWorkspaceRows(
  rows: readonly WorkspaceSpaceWorktree[],
  selectedIds: ReadonlySet<string>,
  isWorktreeDeleting: (worktreeId: string) => boolean = () => false
): WorkspaceSpaceWorktree[] {
  return rows.filter(
    (row) =>
      row.canDelete &&
      row.status === 'ok' &&
      selectedIds.has(row.worktreeId) &&
      !isWorktreeDeleting(row.worktreeId)
  )
}

export function getSelectedDeletableWorkspaceIds(
  rows: readonly WorkspaceSpaceWorktree[],
  selectedIds: ReadonlySet<string>,
  isWorktreeDeleting: (worktreeId: string) => boolean = () => false
): string[] {
  return getSelectedDeletableWorkspaceRows(rows, selectedIds, isWorktreeDeleting).map(
    (row) => row.worktreeId
  )
}

export function getVisibleDeletableWorkspaceIds(
  rows: readonly WorkspaceSpaceWorktree[],
  isWorktreeDeleting: (worktreeId: string) => boolean = () => false
): string[] {
  return rows
    .filter((row) => row.canDelete && row.status === 'ok' && !isWorktreeDeleting(row.worktreeId))
    .map((row) => row.worktreeId)
}
