import { parseExecutionHostId, type ExecutionHostKind } from '../../../shared/execution-host'
import { resolveLocalAgentStartupShell } from '../../../shared/local-agent-startup-shell'
import type { AgentStartupShell } from '../../../shared/tui-agent-startup-shell'
import { getClientLoginShell } from '@/lib/client-login-shell'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import {
  getExecutionHostIdForWorktree,
  type WorktreeRuntimeOwnerState
} from '@/lib/worktree-runtime-owner'

/** Execution owner of a workspace, in the shape `resolveClientAgentStartupShell` wants. */
export function getWorkspaceExecutionHostKind(
  state: WorktreeRuntimeOwnerState,
  worktreeId: string | null | undefined
): ExecutionHostKind | null {
  return parseExecutionHostId(getExecutionHostIdForWorktree(state, worktreeId))?.kind ?? null
}

/**
 * Startup-shell dialect for a command this client's own login shell will run.
 *
 * `executionHostKind` is required, not optional: a locally-listed workspace can
 * still execute on an SSH or runtime host, and only the caller knows which.
 */
export function resolveClientAgentStartupShell(args: {
  platform: NodeJS.Platform
  isRemote: boolean
  terminalWindowsShell?: string | null
  executionHostKind: ExecutionHostKind | null
}): AgentStartupShell | undefined {
  return resolveLocalAgentStartupShell({
    ...args,
    hostPlatform: CLIENT_PLATFORM,
    hostLoginShell: getClientLoginShell()
  })
}
