import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { checkIgnoredPaths } from './check-ignored-paths'
import type { GitRuntimeOptions } from './git-runtime-options'
import { loadHooks } from '../hooks'

// Why: a fresh worktree has no node_modules/.cache, and copying them is slow and
// duplicates disk; `orca.yaml` names the ones every worktree should share instead.

/** Resolve `worktree.sharedDirectories` from the repo-root `orca.yaml` to
 *  concrete repo-relative directories to symlink into a new worktree.
 *
 *  Only directories that exist in the primary checkout **and** are gitignored are
 *  returned: tracked directories are already materialized by the checkout, and
 *  sharing an unignored path would surface the link as a spurious worktree diff.
 *
 *  Never throws — any read/parse/git failure resolves to `[]` so worktree
 *  creation is never blocked by this file. */
export async function resolveWorktreeSharedDirectories(
  repoPath: string,
  options: GitRuntimeOptions = {}
): Promise<string[]> {
  try {
    const configured = loadHooks(repoPath)?.worktree?.sharedDirectories ?? []
    if (configured.length === 0) {
      return []
    }

    // Keep only entries that exist as directories; a listed but absent path
    // (node_modules before install) has nothing to share.
    const existing: string[] = []
    for (const relativePath of configured) {
      try {
        if ((await stat(join(repoPath, relativePath))).isDirectory()) {
          existing.push(relativePath)
        } else {
          console.warn(
            `[worktree-shared-directories] Skipping "${relativePath}": sharedDirectories entries must be directories`
          )
        }
      } catch {
        // Absent in the primary checkout — nothing to share.
      }
    }
    if (existing.length === 0) {
      return []
    }

    const ignored = new Set(await checkIgnoredPaths(repoPath, existing, options))
    for (const relativePath of existing) {
      if (!ignored.has(relativePath)) {
        console.warn(
          `[worktree-shared-directories] Skipping "${relativePath}": only gitignored directories can be shared`
        )
      }
    }
    return existing.filter((relativePath) => ignored.has(relativePath)).sort()
  } catch (error) {
    console.warn('[worktree-shared-directories] Failed to resolve shared directories:', error)
    return []
  }
}
