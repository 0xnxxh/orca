import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { checkIgnoredPaths } from './check-ignored-paths'
import type { GitRuntimeOptions } from './git-runtime-options'
import { loadHooks, loadHooksAsync } from '../hooks'
import type { Repo } from '../../shared/types'

// Why: a fresh worktree has no node_modules/.cache, and copying them is slow and
// duplicates disk; `orca.yaml` names the ones every worktree should share instead.

const CONFIGURED_SHARED_DIRECTORIES_CACHE_TTL_MS = 30_000

type SharedDirectoriesCacheEntry = {
  value: { directories: readonly string[]; expiresAt: number } | null
  /** Bumped on every publish, so a read that started earlier can tell a newer value landed
   *  while it was in flight and must not be clobbered. */
  revision: number
  /** Non-null while an async read is in flight. A stalled mount can leave it set forever —
   *  which is exactly when sync callers must be served the stale value instead of blocking. */
  refresh: Promise<readonly string[]> | null
}

const sharedDirectoriesByRepoPath = new Map<string, SharedDirectoriesCacheEntry>()

function getSharedDirectoriesCacheEntry(repoPath: string): SharedDirectoriesCacheEntry {
  const existing = sharedDirectoriesByRepoPath.get(repoPath)
  if (existing) {
    return existing
  }
  const created: SharedDirectoriesCacheEntry = { value: null, revision: 0, refresh: null }
  sharedDirectoriesByRepoPath.set(repoPath, created)
  return created
}

/** Publishes into the entry object, not the map, so a refresh still in flight when the cache is
 *  cleared writes to its own detached entry instead of resurrecting a stale one. */
function publishSharedDirectories(
  entry: SharedDirectoriesCacheEntry,
  directories: readonly string[]
): readonly string[] {
  entry.value = { directories, expiresAt: Date.now() + CONFIGURED_SHARED_DIRECTORIES_CACHE_TTL_MS }
  entry.revision++
  return directories
}

/** The configured `worktree.sharedDirectories` names, before any existence or
 *  gitignore filtering.
 *
 *  Why deletion can't reuse the resolver below: a directory-only ignore rule
 *  (`node_modules/`) matches the primary's real directory but never the
 *  worktree's symlink, so Git reports that symlink as untracked. Removal has to
 *  tolerate and unlink it, and the resolver would have already dropped it.
 *
 *  `readonly` because this is the cached array itself: a mutating caller would
 *  corrupt every later read for the rest of the TTL. Copying on return would fix
 *  that too, but this runs on the status-polling path — the type costs nothing.
 *
 *  An expired value with a read still in flight is served anyway: a read stalled on a dead
 *  mount never settles, so the entry would stay expired forever and push every sync caller
 *  onto exactly the blocking read the async twin exists to avoid. */
export function getConfiguredWorktreeSharedDirectories(repoPath: string): readonly string[] {
  const entry = sharedDirectoriesByRepoPath.get(repoPath)
  if (entry?.value && (entry.value.expiresAt > Date.now() || entry.refresh !== null)) {
    return entry.value.directories
  }
  return publishSharedDirectories(
    getSharedDirectoriesCacheEntry(repoPath),
    loadHooks(repoPath)?.worktree?.sharedDirectories ?? []
  )
}

/** Single-flight: concurrent status polls share one `orca.yaml` read per repo. */
function refreshConfiguredWorktreeSharedDirectories(repoPath: string): Promise<readonly string[]> {
  const entry = getSharedDirectoriesCacheEntry(repoPath)
  if (entry.refresh) {
    return entry.refresh
  }

  const startedAtRevision = entry.revision
  const refresh: Promise<readonly string[]> = loadHooksAsync(repoPath)
    .then((hooks) => {
      const directories = hooks?.worktree?.sharedDirectories ?? []
      // Why: the sync twin publishes into the same entry. A read that started before it must
      // not overwrite the newer value, nor stamp a fresh TTL onto its own stale one.
      if (entry.revision !== startedAtRevision) {
        return entry.value?.directories ?? directories
      }
      return publishSharedDirectories(entry, directories)
    })
    .catch(() => entry.value?.directories ?? [])
    .finally(() => {
      if (entry.refresh === refresh) {
        entry.refresh = null
      }
    })

  entry.refresh = refresh
  return refresh
}

/** Async twin of `getConfiguredWorktreeSharedDirectories`, for the polled status path.
 *
 *  A stalled repo mount can hold the `orca.yaml` read for a minute; while one is in
 *  flight every later poll is served the last known value instead of queueing behind
 *  it, so status keeps flowing and only the first-ever read can wait. */
export async function getConfiguredWorktreeSharedDirectoriesAsync(
  repoPath: string
): Promise<readonly string[]> {
  const cached = sharedDirectoriesByRepoPath.get(repoPath)?.value
  if (cached && cached.expiresAt > Date.now()) {
    return cached.directories
  }

  const refresh = refreshConfiguredWorktreeSharedDirectories(repoPath)
  return cached ? cached.directories : refresh
}

/** Reset the process cache between tests. */
export function clearConfiguredWorktreeSharedDirectoriesCacheForTests(): void {
  sharedDirectoriesByRepoPath.clear()
}

/** Every path Orca may have symlinked into a worktree: the per-user Worktree
 *  Shared Paths setting plus the repo's `orca.yaml` shared directories.
 *
 *  Callers pair this with `findExistingWorktreeSymlinkPaths`, which keeps only
 *  the entries that really are symlinks — so a configured name that the user
 *  happens to own as a regular file is never treated as one of ours. */
export function getWorktreeSharedLinkPaths(repo: Pick<Repo, 'path' | 'symlinkPaths'>): string[] {
  return Array.from(
    new Set([...(repo.symlinkPaths ?? []), ...getConfiguredWorktreeSharedDirectories(repo.path)])
  )
}

/** Async twin of `getWorktreeSharedLinkPaths` for callers that can await. */
export async function getWorktreeSharedLinkPathsAsync(
  repo: Pick<Repo, 'path' | 'symlinkPaths'>
): Promise<string[]> {
  const configured = await getConfiguredWorktreeSharedDirectoriesAsync(repo.path)
  return Array.from(new Set([...(repo.symlinkPaths ?? []), ...configured]))
}

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
    const configured = (await loadHooksAsync(repoPath))?.worktree?.sharedDirectories ?? []
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
