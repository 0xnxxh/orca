import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../shared/types'

export type UseDetectedAgentsResult = {
  /** Null while detection is in flight on first load. */
  detectedIds: TuiAgent[] | null
  isLoading: boolean
  isRefreshing: boolean
  /** Forces a re-detect on the target host (`preflight.refreshAgents` for
   *  local/runtime targets, a fresh probe for SSH) and updates every
   *  subscribed surface in the same tick. Idempotent while in flight:
   *  concurrent callers receive the same pending promise. */
  refresh: () => Promise<TuiAgent[]>
}

export type AgentDetectionTarget =
  | { kind: 'local' }
  | { kind: 'ssh'; connectionId: string }
  | { kind: 'runtime'; environmentId: string }

function normalizeAgentDetectionTarget(
  target: AgentDetectionTarget | string | null | undefined
): AgentDetectionTarget | undefined {
  if (target === undefined) {
    return undefined
  }
  if (target === null) {
    return { kind: 'local' }
  }
  if (typeof target === 'string') {
    return { kind: 'ssh', connectionId: target }
  }
  return target
}

/**
 * Single source of truth for detected agent IDs across the renderer.
 *
 * Why: previously AgentsPane, NewWorkspaceComposerCard, and
 * `detect-agents-cached.ts` each ran their own detection. A tab-bar button
 * that doesn't refresh when Settings → Agents refreshes would feel broken;
 * centralizing the state eliminates multi-owner drift.
 *
 * @param connectionId — Pass a string for legacy SSH callers, or an
 * AgentDetectionTarget for local/SSH/runtime hosts. Pass null for local
 * detection. Pass undefined when the connection context is not yet known
 * (store not hydrated) — returns loading state.
 */
export function useDetectedAgents(
  connectionId: AgentDetectionTarget | string | null | undefined = null
): UseDetectedAgentsResult {
  const target = normalizeAgentDetectionTarget(connectionId)
  const retriedEmptyTargetRef = useRef<string | null>(null)
  // Why: undefined means "store not yet hydrated" — we don't know if the
  // worktree is local or remote yet. This prevents flashing local agents for
  // remote worktrees during hydration.
  const isUnknown = target === undefined
  const targetKind = target?.kind
  const targetId =
    target?.kind === 'ssh'
      ? target.connectionId
      : target?.kind === 'runtime'
        ? target.environmentId
        : null

  const detectedIds = useAppStore((s) => {
    if (isUnknown) {
      return null
    }
    if (targetKind === 'ssh' && targetId) {
      return s.remoteDetectedAgentIds[targetId] ?? null
    }
    if (targetKind === 'runtime' && targetId) {
      return s.runtimeDetectedAgentIds[targetId] ?? null
    }
    return s.detectedAgentIds
  })
  const isLoading = useAppStore((s) => {
    if (isUnknown) {
      return true
    }
    if (targetKind === 'ssh' && targetId) {
      return s.isDetectingRemoteAgents[targetId] ?? false
    }
    if (targetKind === 'runtime' && targetId) {
      return s.isDetectingRuntimeAgents[targetId] ?? false
    }
    return s.isDetectingAgents
  })
  const isRefreshing = useAppStore((s) => {
    if (targetKind === 'runtime' && targetId) {
      return s.isRefreshingRuntimeAgents[targetId] ?? false
    }
    if (targetKind === 'ssh' && targetId) {
      return s.isDetectingRemoteAgents[targetId] ?? false
    }
    return targetKind === 'local' ? s.isRefreshingAgents : false
  })
  const ensureLocal = useAppStore((s) => s.ensureDetectedAgents)
  const ensureRemote = useAppStore((s) => s.ensureRemoteDetectedAgents)
  const ensureRuntime = useAppStore((s) => s.ensureRuntimeDetectedAgents)
  const refreshLocal = useAppStore((s) => s.refreshDetectedAgents)
  const refreshRuntime = useAppStore((s) => s.refreshRuntimeDetectedAgents)
  const clearRemote = useAppStore((s) => s.clearRemoteDetectedAgents)
  // Why: refresh must hit the same host the list came from — refreshing the
  // local PATH while showing a remote server's agents is a silent no-op.
  const refresh = useCallback((): Promise<TuiAgent[]> => {
    if (targetKind === 'runtime' && targetId) {
      return refreshRuntime(targetId)
    }
    if (targetKind === 'ssh' && targetId) {
      // Why: SSH hosts have no refresh RPC; dropping the cache forces a probe.
      clearRemote(targetId)
      return ensureRemote(targetId)
    }
    return refreshLocal()
  }, [targetKind, targetId, refreshRuntime, clearRemote, ensureRemote, refreshLocal])

  useEffect(() => {
    if (isUnknown) {
      return
    }
    const emptyRetryKey =
      targetKind === 'ssh' && targetId
        ? `ssh:${targetId}`
        : targetKind === 'runtime' && targetId
          ? `runtime:${targetId}`
          : null
    if (targetKind === 'ssh' && targetId) {
      if (detectedIds === null) {
        retriedEmptyTargetRef.current = emptyRetryKey
        void ensureRemote(targetId)
      } else if (detectedIds.length === 0 && retriedEmptyTargetRef.current !== emptyRetryKey) {
        // Why: a newly opened remote launch surface should get one fresh probe
        // after a prior empty result, but must not spin while the host has no agents.
        retriedEmptyTargetRef.current = emptyRetryKey
        void ensureRemote(targetId)
      }
    } else if (targetKind === 'runtime' && targetId) {
      if (detectedIds === null) {
        retriedEmptyTargetRef.current = emptyRetryKey
        void ensureRuntime(targetId)
      } else if (detectedIds.length === 0 && retriedEmptyTargetRef.current !== emptyRetryKey) {
        // Why: remote `orca serve` users can install/fix PATH without reconnecting;
        // retry once per mounted surface so the menu can pick that up.
        retriedEmptyTargetRef.current = emptyRetryKey
        void ensureRuntime(targetId)
      }
    } else {
      if (detectedIds === null) {
        void ensureLocal()
      }
    }
  }, [isUnknown, targetKind, targetId, detectedIds, ensureLocal, ensureRemote, ensureRuntime])

  return { detectedIds, isLoading, isRefreshing, refresh }
}
