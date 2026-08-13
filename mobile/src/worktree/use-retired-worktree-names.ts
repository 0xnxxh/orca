import { useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'

/** Names already spent in a repo, including workspaces that have since been deleted.
 *
 *  Why a targeted request rather than the workspace catalog: the catalog is served by `worktree.ps`,
 *  which carries rows only. Retired names are needed just while the create sheet is open and only
 *  for one repo, so this mirrors the desktop hook and asks for exactly that.
 *
 *  Hosts predating the field omit it, and any failure yields an empty list, so this degrades to
 *  deduping against live workspaces alone — the behavior before retirement existed. */
export function useRetiredWorktreeNames(
  client: RpcClient | null | undefined,
  repoId: string | null | undefined
): { names: readonly string[]; loading: boolean } {
  const [loaded, setLoaded] = useState<{
    repoId: string
    names: readonly string[]
  } | null>(null)

  useEffect(() => {
    if (!client || !repoId) {
      setLoaded(null)
      return
    }
    let cancelled = false
    void client
      .sendRequest('worktree.listRetiredNames', { repo: `id:${repoId}` })
      .then((response) => {
        if (cancelled) {
          return
        }
        const result = (response as { result?: unknown }).result as
          | { retiredNamesByRepo?: Record<string, string[]> }
          | undefined
        const names = result?.retiredNamesByRepo?.[repoId]
        setLoaded({ repoId, names: Array.isArray(names) ? names : [] })
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded({ repoId, names: [] })
        }
      })
    return () => {
      cancelled = true
    }
  }, [client, repoId])

  return {
    names: loaded && loaded.repoId === repoId ? loaded.names : [],
    loading: Boolean(client && repoId) && loaded?.repoId !== repoId
  }
}
