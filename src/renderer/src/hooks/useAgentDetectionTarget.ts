import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { getConnectionIdFromState } from '@/lib/connection-owner-resolution'
import {
  getRuntimeEnvironmentIdForWorktree,
  type WorktreeRuntimeOwnerState
} from '@/lib/worktree-runtime-owner'
import type { AgentDetectionTarget } from './useDetectedAgents'

export const AGENT_DETECTION_LOCAL_TARGET_KEY = 'local'

type AgentDetectionOwnerState = Parameters<typeof getConnectionIdFromState>[0] &
  WorktreeRuntimeOwnerState

/**
 * Resolve which host's agent detection a worktree's launch surfaces must use:
 * the owning SSH host, the owning paired-runtime host, or the local machine.
 * Returns undefined while the store has not hydrated the owning repo yet.
 *
 * Why a string key: selectors must return a stable primitive; building the
 * target object inside the selector would re-render subscribers on every
 * store write.
 */
export function getAgentDetectionTargetKeyForWorktree(
  state: AgentDetectionOwnerState,
  worktreeId: string | null
): string | undefined {
  const connectionId = getConnectionIdFromState(state, worktreeId)
  if (connectionId === undefined) {
    return undefined
  }
  const normalizedConnectionId = connectionId?.trim()
  if (normalizedConnectionId) {
    return `ssh:${normalizedConnectionId}`
  }
  const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)?.trim()
  if (runtimeEnvironmentId) {
    return `runtime:${runtimeEnvironmentId}`
  }
  return AGENT_DETECTION_LOCAL_TARGET_KEY
}

export function parseAgentDetectionTargetKey(
  key: string | undefined
): AgentDetectionTarget | undefined {
  if (key === undefined) {
    return undefined
  }
  if (key === AGENT_DETECTION_LOCAL_TARGET_KEY) {
    return { kind: 'local' }
  }
  if (key.startsWith('ssh:')) {
    return { kind: 'ssh', connectionId: key.slice('ssh:'.length) }
  }
  if (key.startsWith('runtime:')) {
    return { kind: 'runtime', environmentId: key.slice('runtime:'.length) }
  }
  return { kind: 'local' }
}

export function useAgentDetectionTargetForWorktree(
  worktreeId: string | null
): AgentDetectionTarget | undefined {
  const key = useAppStore((s) => getAgentDetectionTargetKeyForWorktree(s, worktreeId))
  return useMemo(() => parseAgentDetectionTargetKey(key), [key])
}
