import type { Store } from '../persistence'
import { folderWorkspaceKey } from '../../shared/workspace-scope'

/**
 * Every workspace key that owns shell history, for the history GC's live set.
 *
 * Why folder workspaces are included: a folder workspace's PTY carries
 * `folder:<id>` as its worktree id (see folder-workspace-composer-submit.ts),
 * so `injectHistoryEnv` mints history under that key exactly as it does for a
 * git worktree. They live in a separate store collection, so a set built only
 * from `getAllWorktreeMeta()` makes every live folder workspace look orphaned —
 * and the GC then deletes history the user is still accumulating.
 */
export function getKnownWorktreeIdsForHistoryGc(
  store: Pick<Store, 'getAllWorktreeMeta' | 'getFolderWorkspaces'>
): Set<string> {
  const live = new Set(Object.keys(store.getAllWorktreeMeta()))
  for (const workspace of store.getFolderWorkspaces()) {
    live.add(folderWorkspaceKey(workspace.id))
  }
  return live
}
