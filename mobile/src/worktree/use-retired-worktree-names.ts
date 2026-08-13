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
): readonly string[] {
  const [retiredNames, setRetiredNames] = useState<readonly string[]>([])

  useEffect(() => {
    if (!client || !repoId) {
      setRetiredNames([])
      return
    }
    let cancelled = false
    void client
      // limit 1 because only the retirement map is wanted; the rows are incidental.
      .sendRequest('worktree.list', { repo: `id:${repoId}`, limit: 1 })
      .then((response) => {
        if (cancelled) {
          return
        }
        const result = (response as { result?: unknown }).result as
          | { retiredNamesByRepo?: Record<string, string[]> }
          | undefined
        const names = result?.retiredNamesByRepo?.[repoId]
        setRetiredNames(Array.isArray(names) ? names : [])
      })
      .catch(() => {
        if (!cancelled) {
          setRetiredNames([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [client, repoId])

  return retiredNames
}
