/**
 * STA-4343: a cleanup row is identified by `repoId::path`, which two execution
 * hosts can both publish. Once a caller confirms ONE host's row, every step of
 * the removal must stay pinned to that host — routing at the ACTIVE workspace's
 * host instead deletes another machine's uncommitted work.
 */
import type { WorktreeSliceGet, WorktreeSliceSet } from '../listing/worktree-slice-types'
import type { RemoveWorktreeResult } from '../../../../../../shared/worktree/create-types'
import type { WorktreeSlice } from '../../worktree-helpers'
import type { getActiveRuntimeTarget } from '../../../../runtime/runtime-rpc-client'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../../../shared/execution-host'
import { resolveWorkspaceCleanupRemovalHostId } from '../../../../../../shared/workspace-cleanup-host-identity'
import {
  getWorktreeOperationOwnerHostIds,
  resolveWorktreeOperationRoute,
  resolveWorktreeOperationRouteForHost,
  type WorktreeOperationRoute
} from '@/lib/worktree-operation-route'
import { captureWorktreeOperationGenerationGuard } from '@/lib/worktree-operation-generation'
import { getRepoIdFromWorktreeId } from '../../worktree-helpers'
import {
  WORKTREE_REMOVAL_AMBIGUOUS_ERROR,
  WORKTREE_REMOVAL_HOST_CHANGED_ERROR
} from '../listing/worktree-slice-constants'
import { requestVirtualizedScrollAnchorRecord } from '@/hooks/requestVirtualizedScrollAnchorRecord'
import { cleanupEphemeralVmRuntimesForDeleted } from '@/lib/ephemeral-vm-runtime-cleanup'
import { purgeOrphanedRuntimeSshProjects } from './orphaned-runtime-ssh-project-purge'
import { showPreservedBranchToast } from '@/components/sidebar/preserved-branch-toast'

import { preservedBranchCleanupKey } from '../../../../../../shared/preserved-branch-cleanup'
import { rememberAuthoritativelyRemovedWorktrees } from '../listing/authoritative-worktree-removal-memory'
import { preservedBranchRuntimeTargetByCleanupKey } from './preserved-branch-cleanup-target'
import { worktreeHostMatchOptions, worktreeMatchesHost } from '../listing/worktree-host-ownership'

type PreservedBranchWorktree = Parameters<typeof showPreservedBranchToast>[1]
type RemoveWorktreeSliceResult = Awaited<ReturnType<WorktreeSlice['removeWorktree']>>

/** Route at the confirmed host when there is one, else the ordinary active-host route. */
function resolveHostQualifiedRemovalRoute(
  get: WorktreeSliceGet,
  worktreeId: string,
  requiredExecutionHostId: ExecutionHostId | null
): WorktreeOperationRoute | null {
  return requiredExecutionHostId
    ? resolveWorktreeOperationRouteForHost(get(), worktreeId, requiredExecutionHostId)
    : resolveWorktreeOperationRoute(get(), worktreeId)
}

export type HostQualifiedRemovalStart =
  | { ok: false; error: string }
  | {
      ok: true
      removalRoute: WorktreeOperationRoute | null
      hostId: ExecutionHostId | undefined
      removalGenerationGuard: ReturnType<typeof captureWorktreeOperationGenerationGuard> | null
      sameIdSurvivesOnAnotherHost: boolean
    }

/**
 * Resolve the route a removal may run on. A caller that confirmed one host's
 * row fails closed unless the route still lands on exactly that host.
 */
export function beginHostQualifiedRemoval(
  get: WorktreeSliceGet,
  worktreeId: string,
  requiredExecutionHostId: ExecutionHostId | null,
  forgetLocalOnly: boolean
): HostQualifiedRemovalStart {
  const resolveRemovalRoute = (): WorktreeOperationRoute | null =>
    resolveHostQualifiedRemovalRoute(get, worktreeId, requiredExecutionHostId)
  const removalRoute = resolveRemovalRoute()
  if (!forgetLocalOnly && !removalRoute) {
    return { ok: false, error: WORKTREE_REMOVAL_AMBIGUOUS_ERROR }
  }
  // Fail closed rather than delete on a host the caller never confirmed.
  if (
    requiredExecutionHostId &&
    removalRoute &&
    removalRoute.executionHostId !== requiredExecutionHostId
  ) {
    return { ok: false, error: WORKTREE_REMOVAL_HOST_CHANGED_ERROR }
  }
  return {
    ok: true,
    removalRoute,
    hostId: removalRoute?.executionHostId ?? requiredExecutionHostId ?? undefined,
    removalGenerationGuard: removalRoute
      ? captureWorktreeOperationGenerationGuard(
          get,
          worktreeId,
          removalRoute,
          () =>
            new Error(
              requiredExecutionHostId
                ? WORKTREE_REMOVAL_HOST_CHANGED_ERROR
                : WORKTREE_REMOVAL_AMBIGUOUS_ERROR
            ),
          // Why: every mid-flight re-check must re-resolve at the CONFIRMED host,
          // or the active host's route would read as "ownership changed".
          requiredExecutionHostId ? resolveRemovalRoute : undefined
        )
      : null,
    sameIdSurvivesOnAnotherHost: preservesSameIdRendererState(
      get(),
      worktreeId,
      requiredExecutionHostId
    )
  }
}

/** The row on the confirmed host only — a same-id row elsewhere must not stand in for it. */
export function findWorktreeOnConfirmedHost(
  get: WorktreeSliceGet,
  worktreeId: string,
  requiredExecutionHostId: ExecutionHostId | null
): PreservedBranchWorktree {
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  return get()
    .allWorktrees()
    .find(
      (entry) =>
        entry.id === worktreeId &&
        (!requiredExecutionHostId ||
          worktreeMatchesHost(
            entry,
            requiredExecutionHostId,
            worktreeHostMatchOptions(get(), repoId, requiredExecutionHostId)
          ))
    )
}

/**
 * True when some OTHER host still owns this same id, so the shared renderer
 * state (tabs, terminals, browsers, editor files) belongs to a workspace that
 * is still alive and must survive this removal.
 */
export function preservesSameIdRendererState(
  state: ReturnType<WorktreeSliceGet>,
  worktreeId: string,
  requiredExecutionHostId: ExecutionHostId | null
): boolean {
  if (requiredExecutionHostId === null) {
    return false
  }
  if (
    getWorktreeOperationOwnerHostIds(state, worktreeId).some(
      (ownerHostId) => ownerHostId !== requiredExecutionHostId
    )
  ) {
    return true
  }
  if (
    state.activeWorktreeId === worktreeId &&
    state.activeWorkspaceExecutionHostId !== null &&
    state.activeWorkspaceExecutionHostId !== requiredExecutionHostId
  ) {
    return true
  }
  return (
    state.workspaceCleanupScan?.candidates.some((candidate) => {
      const candidateHostId = resolveWorkspaceCleanupRemovalHostId(candidate)
      return (
        candidate.worktreeId === worktreeId &&
        candidateHostId !== null &&
        candidateHostId !== requiredExecutionHostId
      )
    }) ?? false
  )
}

/** Drop only the confirmed host's row, leaving the surviving host's state whole. */
function dropConfirmedHostRow(
  set: WorktreeSliceSet,
  worktreeId: string,
  requiredExecutionHostId: ExecutionHostId
): void {
  requestVirtualizedScrollAnchorRecord('[data-worktree-sidebar]')
  set((state) => {
    const nextWorktreesByRepo = { ...state.worktreesByRepo }
    for (const [candidateRepoId, worktrees] of Object.entries(nextWorktreesByRepo)) {
      const matchOptions = worktreeHostMatchOptions(state, candidateRepoId, requiredExecutionHostId)
      nextWorktreesByRepo[candidateRepoId] = worktrees.filter(
        (worktree) =>
          worktree.id !== worktreeId ||
          !worktreeMatchesHost(worktree, requiredExecutionHostId, matchOptions)
      )
    }
    const nextDeleteState = { ...state.deleteStateByWorktreeId }
    delete nextDeleteState[worktreeId]
    return {
      worktreesByRepo: nextWorktreesByRepo,
      deleteStateByWorktreeId: nextDeleteState,
      sortEpoch: state.sortEpoch + 1
    }
  })
  if (parseExecutionHostId(requiredExecutionHostId)?.kind === 'ssh') {
    rememberAuthoritativelyRemovedWorktrees(requiredExecutionHostId, [worktreeId])
  }
}

/**
 * Finish a removal whose id still exists on another host: prune just the
 * confirmed host's row and keep the preserved-branch follow-up pinned to it.
 *
 * Tears down the ephemeral VM even though the shared renderer state survives. A
 * VM is NOT shared: it belongs to the workspace just deleted. The likeliest real
 * collision is one machine reachable as both `runtime:env` and `ssh:target`, so
 * skipping it left the VM running and billing after its row was removed. Safe to
 * do here without the full path's ordering care, because this path tears down no
 * terminals — there is no still-mounted pane to race a disposed relay.
 */
export async function completeSameIdHostScopedRemoval(args: {
  set: WorktreeSliceSet
  get: WorktreeSliceGet
  worktreeId: string
  requiredExecutionHostId: ExecutionHostId
  removalResult: RemoveWorktreeResult | undefined
  removalRoute: WorktreeOperationRoute | null
  target: ReturnType<typeof getActiveRuntimeTarget>
  worktreeBeforeRemoval: PreservedBranchWorktree
  suppressPreservedBranchToast: boolean
}): Promise<Awaited<RemoveWorktreeSliceResult>> {
  const {
    set,
    get,
    worktreeId,
    requiredExecutionHostId,
    removalResult,
    removalRoute,
    target,
    worktreeBeforeRemoval,
    suppressPreservedBranchToast
  } = args
  const runtimeCleanup = await cleanupEphemeralVmRuntimesForDeleted({
    workspaceIds: [worktreeId]
  })
  await purgeOrphanedRuntimeSshProjects(get, runtimeCleanup.destroyedSshTargetIds)
  dropConfirmedHostRow(set, worktreeId, requiredExecutionHostId)
  const preservedBranch = removalResult?.preservedBranch
  if (!preservedBranch) {
    return { ok: true as const }
  }
  const runtimeEnvironment = removalRoute?.runtimeEnvironmentId
    ? { runtimeEnvironmentId: removalRoute.runtimeEnvironmentId }
    : {}
  const cleanup = {
    worktreeId,
    branchName: preservedBranch.branchName,
    expectedHead: preservedBranch.head,
    hostId: requiredExecutionHostId,
    ...runtimeEnvironment
  }
  preservedBranchRuntimeTargetByCleanupKey.set(preservedBranchCleanupKey(cleanup), {
    cleanup,
    target
  })
  if (!suppressPreservedBranchToast) {
    showPreservedBranchToast(removalResult, worktreeBeforeRemoval, (branch, expectedHead) => {
      void get().forceDeletePreservedBranch(worktreeId, branch, expectedHead, {
        hostId: requiredExecutionHostId,
        ...runtimeEnvironment
      })
    })
  }
  return {
    ok: true as const,
    preservedBranch: { ...preservedBranch, hostId: requiredExecutionHostId, ...runtimeEnvironment }
  }
}
