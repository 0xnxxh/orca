import { translate } from '@/i18n/i18n'
import {
  collectWorktreeOwnerExecutionHostIds,
  type WorktreeOperationRouteState
} from '@/lib/worktree-operation-route'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import {
  verifyWorktreeRemovalHost,
  type WorktreeRemovalTarget
} from '../../../../../../shared/worktree/removal'

/**
 * The refusal to report, or null when the removal provably lands on the host
 * whose row was confirmed (STA-4448).
 *
 * Reuses the cleanup dialog's copy (#14731) so both delete surfaces explain a
 * wrong-host refusal in the same words.
 */
export function refuseWrongHostWorktreeRemoval(
  state: WorktreeOperationRouteState,
  target: WorktreeRemovalTarget,
  routeExecutionHostId: ExecutionHostId | null
): string | null {
  const verdict = verifyWorktreeRemovalHost({
    confirmedExecutionHostId: target.executionHostId,
    ownerExecutionHostIds: collectWorktreeOwnerExecutionHostIds(state, target.id),
    routeExecutionHostId
  })
  if (verdict.kind === 'allowed') {
    return null
  }
  return verdict.reason === 'collision'
    ? translate(
        'auto.store.slices.workspace.cleanup.hostCollision',
        'Error: this workspace exists on multiple hosts at the same path'
      )
    : translate(
        'auto.store.slices.workspace.cleanup.hostUnresolved',
        'Orca cannot tell which host owns this workspace. Refresh projects and review it again.'
      )
}
