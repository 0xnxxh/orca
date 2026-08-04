import { setCachedWorktrees } from '../cache/worktree-cache'
import { sendSingleFlightRequest } from '../transport/request-single-flight'
import type { RpcClient } from '../transport/rpc-client'
import {
  markHomeWorktreeCatalogUnavailable,
  type HomeWorktreeSummary,
  type HostWorktreeInfo
} from './home-worktree-info'
import { pickResumeWorktree } from './resume-worktree'
import { WORKTREE_PS_FULL_LIMIT } from './worktree-catalog-snapshot-client'

const ACTIVE_STATUSES = new Set(['working', 'active', 'permission'])

export type HostWorktreeInfoSetter = (
  updater: (prev: Record<string, HostWorktreeInfo>) => Record<string, HostWorktreeInfo>
) => void

/** Reads one host's worktree catalog for the Home card, preserving proven counts on failure. */
export function fetchHomeHostWorktreeInfo(
  client: RpcClient,
  hostId: string,
  setInfo: HostWorktreeInfoSetter,
  disposed: () => boolean
): Promise<void> {
  const markUnavailable = (): void => {
    setInfo((prev) => {
      const current = prev[hostId]
      const next = markHomeWorktreeCatalogUnavailable(current, hostId)
      return next === current ? prev : { ...prev, [hostId]: next }
    })
  }

  return sendSingleFlightRequest(client, hostId, 'worktree.ps', { limit: WORKTREE_PS_FULL_LIMIT })
    .then((response) => {
      if (disposed()) {
        return
      }
      if (!response.ok) {
        markUnavailable()
        return
      }
      const result = response.result as { worktrees?: HomeWorktreeSummary[] }
      const worktrees = result.worktrees ?? []
      setCachedWorktrees(hostId, worktrees)
      const active = worktrees.filter((w) => w.status && ACTIVE_STATUSES.has(w.status))
      // Mirror the desktop's focused workspace (see pickResumeWorktree).
      const lastActive = pickResumeWorktree(worktrees)
      setInfo((prev) => ({
        ...prev,
        [hostId]: {
          hostId,
          totalWorktrees: worktrees.length,
          activeCount: active.length,
          lastActiveWorktree: lastActive
        }
      }))
    })
    .catch(() => {
      // A rejected in-flight read (socket died mid-request) is a failed refresh, not an empty host.
      if (!disposed()) {
        markUnavailable()
      }
    })
}
