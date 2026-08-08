import type { IPtyProvider, PtyProcessInfo } from '../providers/types'
import type { OrcaRuntimeService } from './orca-runtime'
import {
  isUnstoppedPtyRemovalError,
  WORKTREE_TEARDOWN_FORCE_HINT,
  WORKTREE_TEARDOWN_TIMEOUT_PREFIX
} from '../../shared/worktree-removal'
import { settleBeforeDeadline } from './settle-before-deadline'
import { createWorktreeSweepTracker, settleSweepsForForcedRemoval } from './forced-sweep-settlement'
import {
  clearStoppedPtyState,
  sweepProviderPtysForWorktree,
  sweepRegisteredPtysForWorktree
} from './worktree-pty-inventory-sweep'
import {
  describeError,
  describeFailedPtySweep,
  describeUnstoppedPtys,
  verifyUnstoppedPtys,
  type UnstoppedPtyVerdict
} from './unstopped-pty-verification'

export type WorktreeTeardownDeps = {
  runtime?: OrcaRuntimeService
  /** Authoritative id for callers whose selector no longer resolves (orphaned workspace). */
  resolvedWorktreeId?: string
  /** SSH connection owning `resolvedWorktreeId`; prevents same-id cross-host graph matches. */
  resolvedConnectionId?: string
  /** Runtime environment owning a mirrored `resolvedWorktreeId`. */
  resolvedRuntimeEnvironmentId?: string
  localProvider: IPtyProvider
  onPtyStopped?: (ptyId: string) => void
  timeoutMs?: number
  requirePhysicalStop?: boolean
  /** Explicit Force Delete only: warn instead of throwing when a stop stays unproven (#11960). */
  allowUnverifiedStop?: boolean
  includeProviderInventory?: boolean
  includeLocalRegistry?: boolean
}

export type WorktreeTeardownResult = {
  runtimeStopped: number
  providerStopped: number
  registryStopped: number
}

export const WORKTREE_PROCESS_SWEEP_TIMEOUT_MS = 10_000

// Why: keep each bounded stop RPC settling before the sweep deadline itself, so
// a wedged provider surfaces as a stop failure rather than as the outer timeout.
// (The recheck this margin once also reserved time for now runs on its own
// budget — see verifyUnstoppedPtys — because sharing this one wedged #11960.)
export const WORKTREE_TEARDOWN_RPC_MARGIN_MS = 500

// Absolute deadline (epoch ms) threaded into provider RPCs on the destructive
// path; each RPC leaf converts it to the remaining time when it actually issues,
// so sequential RPCs share one budget without any relative-timeout bookkeeping.
export function teardownRpcDeadline(sweepDeadline: number): number {
  return sweepDeadline - WORKTREE_TEARDOWN_RPC_MARGIN_MS
}

/**
 * Kills every PTY we can prove belongs to `worktreeId`, across all three
 * registration surfaces (renderer graph, installed PTY provider session list,
 * local pty-registry).
 *
 * Why all three:
 *  - runtime.leaves is authoritative when the renderer is attached, but is
 *    empty in the headless-CLI case (see design §2b).
 *  - The installed provider's listProcesses() surfaces daemon sessions by
 *    the `${worktreeId}@@` session-id contract (§3.1). Because daemon-init
 *    installs the daemon adapter AS the localProvider via
 *    setLocalPtyProvider(), a single call reaches the right backend in both
 *    daemon-on and daemon-off configurations. LocalPtyProvider uses numeric
 *    ids, so the prefix filter is a safe no-op when the daemon is absent.
 *  - pty-registry covers the fallback local provider case and is the
 *    canonical source for memory attribution; it also redundantly backstops
 *    daemon spawns.
 *
 * Sweeps are best-effort by default. Destructive removal callers set
 * `requirePhysicalStop` so a timeout or unproven stop blocks filesystem work.
 * `allowUnverifiedStop` waives that proof so the gate can never wedge a
 * workspace permanently (#11960) — it must come only from an explicit Force
 * Delete or `--force`, never from the `force` an ordinary confirmed delete
 * already sets to skip the dirty-file prompt.
 */
export async function killAllProcessesForWorktree(
  worktreeId: string,
  deps: WorktreeTeardownDeps
): Promise<WorktreeTeardownResult> {
  const sweepBudgetMs = Math.max(1, deps.timeoutMs ?? WORKTREE_PROCESS_SWEEP_TIMEOUT_MS)
  const deadline = Date.now() + sweepBudgetMs
  const deadlineError = new Error(
    `${WORKTREE_TEARDOWN_TIMEOUT_PREFIX} ${worktreeId}. ${WORKTREE_TEARDOWN_FORCE_HINT}`
  )
  const sweeps = createWorktreeSweepTracker()
  let providerInventory: Promise<PtyProcessInfo[]> | null = null
  const loadProviderInventory = (): Promise<PtyProcessInfo[]> => {
    providerInventory ??= deps.localProvider.listProcesses({
      deadlineMs: teardownRpcDeadline(deadline)
    })
    return providerInventory
  }
  const stopAttempts = new Map<string, Promise<boolean>>()
  const stopPty = (
    ptyId: string,
    stop: () => boolean | Promise<boolean>
  ): Promise<{ stopped: boolean; owner: boolean }> => {
    const previous = stopAttempts.get(ptyId) ?? Promise.resolve(false)
    const current = previous
      .then(async (stopped) => {
        if (stopped) {
          return { stopped: true, owner: false }
        }
        const didStop = await stop()
        return { stopped: didStop, owner: didStop }
      })
      .catch(() => ({ stopped: false, owner: false }))
    stopAttempts.set(
      ptyId,
      current.then(({ stopped }) => stopped)
    )
    return current
  }

  // Why: headless CLI has no ready renderer graph, and a just-created/removed
  // worktree may not resolve in the graph yet; either case means zero
  // runtime-owned PTYs, so both sentinels fall through instead of failing
  // destructive removal closed.
  const runtimeSweep = deps.runtime
    ? settleBeforeDeadline(
        sweeps.track(() =>
          deps.runtime!.stopTerminalsForWorktree(worktreeId, {
            deadline,
            stopPty,
            ...(deps.resolvedWorktreeId ? { resolvedWorktreeId: deps.resolvedWorktreeId } : {}),
            ...(deps.resolvedConnectionId
              ? { resolvedConnectionId: deps.resolvedConnectionId }
              : {}),
            ...(deps.resolvedRuntimeEnvironmentId
              ? { resolvedRuntimeEnvironmentId: deps.resolvedRuntimeEnvironmentId }
              : {})
          })
        ),
        { stopped: 0 },
        deadline,
        deps.requirePhysicalStop ? deadlineError : undefined,
        (error) =>
          !(
            error instanceof Error &&
            (error.message === 'runtime_unavailable' || error.message === 'selector_not_found')
          )
      )
    : Promise.resolve({ stopped: 0 })
  const providerSweep =
    deps.includeProviderInventory === false
      ? Promise.resolve(0)
      : settleBeforeDeadline(
          sweeps.track(() =>
            sweepProviderPtysForWorktree(
              worktreeId,
              deps.localProvider,
              deadline,
              teardownRpcDeadline(deadline),
              stopPty,
              deps.onPtyStopped,
              deps.requirePhysicalStop === true,
              loadProviderInventory
            )
          ),
          0,
          deadline,
          deps.requirePhysicalStop ? deadlineError : undefined
        )
  const registrySweep =
    deps.includeLocalRegistry === false
      ? Promise.resolve(0)
      : settleBeforeDeadline(
          sweeps.track(() =>
            sweepRegisteredPtysForWorktree(
              worktreeId,
              deps.localProvider,
              deadline,
              teardownRpcDeadline(deadline),
              stopPty,
              deps.onPtyStopped,
              deps.requirePhysicalStop === true,
              loadProviderInventory
            )
          ),
          0,
          deadline,
          deps.requirePhysicalStop ? deadlineError : undefined
        )
  // Why: a rejection here can outlive this call, and only one of the two paths
  // below observes every promise, so mark them all handled up front.
  for (const sweep of [runtimeSweep, providerSweep, registrySweep]) {
    void sweep.catch(() => undefined)
  }
  let runtimeResult: { stopped: number }
  let providerStopped: number
  let registryStopped: number
  if (deps.allowUnverifiedStop) {
    const forced = await settleSweepsForForcedRemoval(
      worktreeId,
      { runtime: runtimeSweep, provider: providerSweep, registry: registrySweep },
      sweeps,
      deadlineError
    )
    if (forced.incomplete) {
      return forced.stopped
    }
    runtimeResult = { stopped: forced.stopped.runtimeStopped }
    providerStopped = forced.stopped.providerStopped
    registryStopped = forced.stopped.registryStopped
  } else {
    // Why: without the waiver a rejection aborts the removal and nothing is
    // deleted, so failing fast is safe — and keeps a dead host reporting
    // immediately instead of after the full sweep budget.
    try {
      ;[runtimeResult, providerStopped, registryStopped] = await Promise.all([
        runtimeSweep,
        providerSweep,
        registrySweep
      ])
    } catch (error) {
      // Why (#11960): this rejection is the provider's own wording, which the force
      // classifier cannot recognise — so the wedge Force Delete exists for was the one
      // failure that never offered it. Re-word it, keeping the original as the cause.
      throw deps.requirePhysicalStop && !isUnstoppedPtyRemovalError(describeError(error))
        ? new Error(
            `${describeFailedPtySweep(worktreeId, error)}. ${WORKTREE_TEARDOWN_FORCE_HINT}`,
            { cause: error }
          )
        : error
    }
  }
  if (deps.requirePhysicalStop) {
    const stopResults = await Promise.all(
      [...stopAttempts].map(async ([ptyId, stopped]) => [ptyId, await stopped] as const)
    )
    const failedPtyIds = stopResults.filter(([, stopped]) => !stopped).map(([ptyId]) => ptyId)
    const verdict: UnstoppedPtyVerdict =
      failedPtyIds.length === 0
        ? { status: 'exited' }
        : await verifyUnstoppedPtys(failedPtyIds, deps.localProvider, sweepBudgetMs)
    if (verdict.status === 'exited') {
      for (const ptyId of failedPtyIds) {
        clearStoppedPtyState(ptyId, deps.onPtyStopped)
      }
    } else {
      const summary = describeUnstoppedPtys(worktreeId, failedPtyIds, verdict)
      if (!deps.allowUnverifiedStop) {
        throw new Error(`${summary}. ${WORKTREE_TEARDOWN_FORCE_HINT}`)
      }
      // Why: force is the documented escape hatch, so removal continues — but the
      // registry rows stay put. Dropping them would unregister a PTY we just saw
      // alive, so a retry could no longer find it and the user could never see it
      // (the discoverability half of #11960).
      console.warn(`[worktree-teardown] forcing removal despite unstopped PTYs — ${summary}`)
    }
  }

  return { runtimeStopped: runtimeResult.stopped, providerStopped, registryStopped }
}
