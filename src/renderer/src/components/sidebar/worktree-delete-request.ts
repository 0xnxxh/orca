import type { Worktree } from '../../../../shared/worktree/types'
import type { PreservedBranchCleanup } from '@/lib/preserved-branch-cleanup'
import { normalizeExecutionHostId } from '../../../../shared/execution-host'

export type WorktreeBatchDeleteOptions = {
  forceConfirm?: boolean
  onDeleted?: (worktreeIds: string[]) => void
}

/** `hostId` rides along because `id` alone repeats across hosts (STA-4448). */
export type WorktreeDeleteIdentity = Pick<Worktree, 'id' | 'instanceId' | 'hostId'>

export type WorktreeDeleteOptions = {
  expectedInstanceId?: string
}

export type WorktreeDeleteWithToastOptions = {
  force?: boolean
  onForceDeleted?: (worktreeId: string) => void
  onPreservedBranch?: (branch: PreservedBranchCleanup) => void
  suppressPreservedBranchToast?: boolean
  snapshotPruneBatchId?: string
  // Batch deletion commits one focus handoff after all targets settle.
  focusSuccessorOnDelete?: boolean
}

export function toWorktreeDeleteIdentities(
  worktrees: readonly Pick<Worktree, 'id' | 'instanceId' | 'hostId'>[]
): WorktreeDeleteIdentity[] {
  return worktrees.map(({ id, instanceId, hostId }) => ({ id, instanceId, hostId }))
}

export function resolveWorktreeBatchDeleteTargets(
  requestedWorktrees: readonly string[] | readonly WorktreeDeleteIdentity[],
  worktreeMap: ReadonlyMap<string, Worktree>
): Worktree[] | null {
  const uniqueRequests = Array.from(
    new Map(
      requestedWorktrees.map(
        (request) => [typeof request === 'string' ? request : request.id, request] as const
      )
    ).values()
  )
  const targets: Worktree[] = []
  for (const request of uniqueRequests) {
    const worktreeId = typeof request === 'string' ? request : request.id
    const target = worktreeMap.get(worktreeId) ?? null
    if (typeof request !== 'string' && (!target || target.instanceId !== request.instanceId)) {
      return null
    }
    // Why (STA-4448): the id-keyed map holds one row per `repoId::path`, so a
    // refresh can swap in another host's row for the confirmed id. `instanceId`
    // misses that whenever either row predates instance ids, and confirming a
    // remote row must never fall through to a local checkout at the same path.
    if (typeof request !== 'string' && request.hostId && target?.hostId !== request.hostId) {
      return null
    }
    if (target && !target.isMainWorktree) {
      targets.push(target)
    }
  }
  return targets
}

export function readWorktreeDeleteIdentities(value: unknown): WorktreeDeleteIdentity[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'string') {
      return []
    }
    const instanceId = 'instanceId' in entry ? entry.instanceId : undefined
    if (instanceId !== undefined && typeof instanceId !== 'string') {
      return []
    }
    const hostId = normalizeExecutionHostId(
      'hostId' in entry && typeof entry.hostId === 'string' ? entry.hostId : null
    )
    return [{ id: entry.id, instanceId, ...(hostId ? { hostId } : {}) }]
  })
}
