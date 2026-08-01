import type { ExecutionHostId } from '../../shared/execution-host'

export function mobileTerminalMaterializationKey(identity: {
  executionHostId: ExecutionHostId
  connectionId: string | null
  worktreeId: string
  parentTabId: string
  leafId: string
  sessionId?: string
}): string {
  return JSON.stringify([
    identity.executionHostId,
    identity.connectionId,
    identity.worktreeId,
    identity.parentTabId,
    identity.leafId,
    identity.sessionId ?? null
  ])
}
