import { useEffect, useState } from 'react'

const NO_RETIRED_NAMES: readonly string[] = []

/** Names already spent in a repo, including workspaces that have since been deleted.
 *
 *  Why this is fetched rather than derived from the worktree list: a deleted workspace leaves no
 *  row behind, but its directory may still hold agent conversation state keyed by that path. Only
 *  the host-side registry remembers it, so name suggestions must ask for it explicitly.
 *
 *  Stale-while-revalidate across `refreshKey`, reset only when the repo changes. A refresh fires on
 *  every workspace-list mutation, so create-multiple refetches after each create — dropping to
 *  empty in between would suggest a spent name in exactly that window, which is when
 *  `resetForNextCreate` clears the field. Holding the previous answer also keeps the returned array
 *  referentially stable, so the suggestion memo downstream does not rerun on every refetch.
 *
 *  Failure returns an empty set, which degrades to the pre-existing behavior (a spent name can be
 *  suggested) rather than blocking workspace creation. */
export function useRetiredWorktreeNames(
  repoId: string | null | undefined,
  refreshKey: unknown
): {
  names: readonly string[]
  loading: boolean
} {
  const [loaded, setLoaded] = useState<{
    repoId: string
    refreshKey: unknown
    names: readonly string[]
  } | null>(null)

  useEffect(() => {
    if (!repoId) {
      setLoaded(null)
      return
    }
    let cancelled = false
    void window.api.worktrees
      .listRetiredNames({ repoId })
      .then((names) => {
        if (!cancelled) {
          setLoaded({ repoId, refreshKey, names })
        }
      })
      .catch((err) => {
        if (!cancelled) {
          // Keep whatever a previous refresh loaded; a transient failure must not un-retire names.
          setLoaded((previous) => ({
            repoId,
            refreshKey,
            names: previous?.repoId === repoId ? previous.names : NO_RETIRED_NAMES
          }))
        }
        console.warn(`Failed to load retired workspace names for repo ${repoId}:`, err)
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey, repoId])

  return {
    names: loaded && loaded.repoId === repoId ? loaded.names : NO_RETIRED_NAMES,
    loading: Boolean(repoId) && (loaded?.repoId !== repoId || loaded?.refreshKey !== refreshKey)
  }
}
