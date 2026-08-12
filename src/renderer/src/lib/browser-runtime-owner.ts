import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import {
  getRuntimeEnvironmentIdForWorktree,
  type WorktreeRuntimeOwnerState
} from './worktree-runtime-owner'

export function getBrowserRuntimeHostIdForWorktree(
  state: WorktreeRuntimeOwnerState,
  worktreeId: string
): ExecutionHostId {
  const environmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  return environmentId ? toRuntimeExecutionHostId(environmentId) : LOCAL_EXECUTION_HOST_ID
}
