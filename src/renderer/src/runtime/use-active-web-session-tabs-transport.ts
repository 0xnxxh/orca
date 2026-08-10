import { useEffect } from 'react'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { isRuntimeSubscriptionReplayResponse } from '../../../shared/runtime-subscription-replay'
import {
  type ActiveSessionTabsContext,
  type ActiveSessionTabsContextRef,
  recoverAndApplyWebSessionTabsSnapshots
} from './web-session-tabs-active-snapshot'
import { isRuntimeSessionTabsSnapshot, isSessionTabsSnapshotEvent } from './web-session-tabs-events'
import type { GlobalSessionTabsCoverage } from './web-session-tabs-global-subscription'
import {
  acceptReplayedWebSessionTabsSnapshot,
  shouldSyncRuntimeSessionTabs
} from './web-session-tabs-sync'
import { getRuntimeEnvironmentRevision } from './runtime-environment-revision'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'

const ACTIVE_SNAPSHOT_TIMEOUT_MS = 15_000

type ActiveTransportArgs = {
  context: ActiveSessionTabsContext | null
  activeContextRef: ActiveSessionTabsContextRef
  coverage: GlobalSessionTabsCoverage | undefined
  workspaceSessionReady: boolean
}

function startActiveWebSessionTabsTransport(args: ActiveTransportArgs): () => void {
  const { context, activeContextRef, coverage, workspaceSessionReady } = args
  if (
    !context ||
    !shouldSyncRuntimeSessionTabs({
      activeWorktreeId: context.worktreeId,
      activeWorktreeRuntimeEnvironmentId: context.environmentId,
      workspaceSessionReady
    })
  ) {
    return () => {}
  }
  acceptReplayedWebSessionTabsSnapshot(context.environmentId, context.worktreeId)
  if (coverage?.status === 'ready' && coverage.servicedActiveContext === context) {
    return () => {}
  }

  let disposed = false
  let startedScopedFallback = false
  let unsubscribe: (() => void) | null = null
  const isCurrent = (): boolean =>
    !disposed &&
    activeContextRef.current === context &&
    getRuntimeEnvironmentRevision(context.environmentId) === context.pairingRevision
  const applySnapshot = (
    snapshot: Parameters<typeof recoverAndApplyWebSessionTabsSnapshots>[0]['snapshots'][number],
    options: { replayed: boolean; acceptCurrent?: boolean }
  ): Promise<ActiveSessionTabsContext | null> =>
    recoverAndApplyWebSessionTabsSnapshots({
      environmentId: context.environmentId,
      targetKey: context.targetKey,
      snapshots: [snapshot],
      replayed: options.replayed,
      acceptCurrent: options.acceptCurrent ?? false,
      activeContextRef,
      isCurrent
    })
  const startScopedFallback = (): void => {
    if (!isCurrent() || startedScopedFallback) {
      return
    }
    startedScopedFallback = true
    void window.api.runtimeEnvironments
      .subscribe(
        {
          selector: context.environmentId,
          method: 'session.tabs.subscribe',
          params: { worktree: toRuntimeWorktreeSelector(context.worktreeId) },
          timeoutMs: ACTIVE_SNAPSHOT_TIMEOUT_MS,
          expectedEnvironmentPairingRevision: context.pairingRevision
        },
        {
          onResponse: (response: RuntimeRpcResponse<unknown>) => {
            if (!isCurrent()) {
              return
            }
            if (response.ok === false) {
              console.warn('[web-session-tabs-sync] subscription failed:', response.error.message)
              return
            }
            if (
              !isSessionTabsSnapshotEvent(response.result) ||
              response.result.worktree !== context.worktreeId
            ) {
              return
            }
            void applySnapshot(
              { snapshot: response.result, type: response.result.type },
              { replayed: isRuntimeSubscriptionReplayResponse(response) }
            ).catch((error) => {
              if (isCurrent()) {
                console.warn('[web-session-tabs-sync] active snapshot recovery failed:', error)
              }
            })
          },
          onError: (error) =>
            console.warn('[web-session-tabs-sync] subscription error:', error.message)
        }
      )
      .then((handle) => {
        if (disposed) {
          handle.unsubscribe()
        } else {
          unsubscribe = handle.unsubscribe
        }
      })
      .catch((error) => {
        if (!disposed) {
          console.warn(
            '[web-session-tabs-sync] failed to subscribe:',
            error instanceof Error ? error.message : String(error)
          )
        }
      })
  }

  if (coverage?.status !== 'ready') {
    startScopedFallback()
  } else {
    void window.api.runtimeEnvironments
      .call({
        selector: context.environmentId,
        method: 'session.tabs.list',
        params: { worktree: toRuntimeWorktreeSelector(context.worktreeId) },
        timeoutMs: ACTIVE_SNAPSHOT_TIMEOUT_MS,
        expectedEnvironmentPairingRevision: context.pairingRevision
      })
      .then((response: RuntimeRpcResponse<unknown>) => {
        if (
          !isCurrent() ||
          response.ok === false ||
          !isRuntimeSessionTabsSnapshot(response.result) ||
          response.result.worktree !== context.worktreeId
        ) {
          startScopedFallback()
          return
        }
        return applySnapshot(
          { snapshot: response.result, type: 'snapshot' },
          { replayed: false, acceptCurrent: true }
        ).then((serviced) => {
          if (serviced !== context) {
            startScopedFallback()
          }
        })
      })
      .catch(startScopedFallback)
  }

  return () => {
    disposed = true
    unsubscribe?.()
  }
}

export function useActiveWebSessionTabsTransport(args: ActiveTransportArgs): void {
  const { activeContextRef, context, coverage, workspaceSessionReady } = args
  useEffect(
    () =>
      startActiveWebSessionTabsTransport({
        activeContextRef,
        context,
        coverage,
        workspaceSessionReady
      }),
    [activeContextRef, context, coverage, workspaceSessionReady]
  )
}
