import { useEffect, useState } from 'react'

/** Names already spent in a repo, including workspaces that have since been deleted.
 *
 *  Why this is fetched rather than derived from the worktree list: a deleted workspace leaves no
 *  row behind, but its directory may still hold agent conversation state keyed by that path. Only
 *  the host-side registry remembers it, so name suggestions must ask for it explicitly.
 *
 *  Failure returns an empty set, which degrades to the pre-existing behavior (a spent name can be
 *  suggested) rather than blocking workspace creation. */
export function useRetiredWorktreeNames(repoId: string | null | undefined): string[] {
  const [retiredNames, setRetiredNames] = useState<string[]>([])

  useEffect(() => {
    if (!repoId) {
      setRetiredNames([])
      return
    }
    let cancelled = false
    void window.api.worktrees
      .listRetiredNames({ repoId })
      .then((names) => {
        if (!cancelled) {
          setRetiredNames(names)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRetiredNames([])
        }
        console.warn(`Failed to load retired workspace names for repo ${repoId}:`, err)
      })
    return () => {
      cancelled = true
    }
  }, [repoId])

  return retiredNames
}
