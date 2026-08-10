import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { isRuntimeSubscriptionReplayResponse } from '../../../shared/runtime-subscription-replay'
import { getRuntimeEnvironmentRevision } from './runtime-environment-revision'
import {
  isSessionTabsListAllResult,
  isSessionTabsSnapshotEvent,
  isSessionTabsSnapshotsEvent
} from './web-session-tabs-events'
import {
  recoverAndApplyWebSessionTabsSnapshots,
  type ActiveSessionTabsContext,
  type ActiveSessionTabsContextRef
} from './web-session-tabs-active-snapshot'

const INITIAL_SNAPSHOT_TIMEOUT_MS = 15_000

export type GlobalSessionTabsCoverage =
  | {
      status: 'ready'
      generation: number
      servicedActiveContext: ActiveSessionTabsContext | null
    }
  | { status: 'unavailable' }

export type GlobalSessionTabsCoverageSignal =
  | { status: 'ready'; servicedActiveContext: ActiveSessionTabsContext | null }
  | { status: 'unavailable' }

type StartGlobalSubscriptionArgs = {
  environmentId: string
  targetKey: string
  expectedRuntimeId: string
  expectedEnvironmentPairingRevision: number
  activeContextRef: ActiveSessionTabsContextRef
  onCoverage: (coverage: GlobalSessionTabsCoverageSignal) => void
}

export function startGlobalWebSessionTabsSubscription(
  args: StartGlobalSubscriptionArgs
): () => void {
  let disposed = false
  let receivedInitialSnapshots = false
  let requestedInitialFallback = false
  let unsubscribe: (() => void) | null = null
  let coverageRevision = 0
  let hasReadyCoverage = false
  let publishedServicedActiveContext: ActiveSessionTabsContext | null = null
  let pendingServicedActiveContext: ActiveSessionTabsContext | null = null
  const pairingIsCurrent = (): boolean =>
    getRuntimeEnvironmentRevision(args.environmentId) === args.expectedEnvironmentPairingRevision
  const isCurrent = (): boolean => !disposed && pairingIsCurrent()
  const isRecoveryCurrent = (revision: number): boolean =>
    isCurrent() && revision === coverageRevision
  const applySnapshots = (
    snapshots: Parameters<typeof recoverAndApplyWebSessionTabsSnapshots>[0]['snapshots'],
    options: { replayed: boolean; acceptCurrent?: boolean; recoveryRevision?: number }
  ): Promise<ActiveSessionTabsContext | null> => {
    const recoveryRevision = options.recoveryRevision
    return recoverAndApplyWebSessionTabsSnapshots({
      environmentId: args.environmentId,
      targetKey: args.targetKey,
      snapshots,
      replayed: options.replayed,
      acceptCurrent: options.acceptCurrent ?? false,
      activeContextRef: args.activeContextRef,
      isCurrent:
        recoveryRevision === undefined ? isCurrent : () => isRecoveryCurrent(recoveryRevision)
    })
  }
  const markUnavailable = (): void => {
    coverageRevision += 1
    hasReadyCoverage = false
    publishedServicedActiveContext = null
    pendingServicedActiveContext = null
    if (isCurrent()) {
      args.onCoverage({ status: 'unavailable' })
    }
  }
  const requestInitialSnapshotFallback = (): void => {
    if (!isCurrent() || receivedInitialSnapshots || requestedInitialFallback) {
      return
    }
    requestedInitialFallback = true
    clearTimeout(initialSnapshotTimer)
    void window.api.runtimeEnvironments
      .call({
        selector: args.environmentId,
        method: 'session.tabs.listAll',
        params: {},
        timeoutMs: INITIAL_SNAPSHOT_TIMEOUT_MS,
        expectedEnvironmentPairingRevision: args.expectedEnvironmentPairingRevision
      })
      .then((response: RuntimeRpcResponse<unknown>) => {
        if (!isCurrent()) {
          return
        }
        if (response.ok === false) {
          console.warn('[web-session-tabs-sync] fallback listAll failed:', response.error.message)
          return
        }
        if (!isSessionTabsListAllResult(response.result)) {
          console.warn('[web-session-tabs-sync] fallback listAll returned an invalid payload')
          return
        }
        return applySnapshots(
          response.result.snapshots.map((snapshot) => ({ snapshot, type: 'snapshot' as const })),
          { replayed: false }
        )
      })
      .catch((error) => {
        if (isCurrent()) {
          console.warn(
            '[web-session-tabs-sync] failed to load fallback session tabs:',
            error instanceof Error ? error.message : String(error)
          )
        }
      })
  }
  const initialSnapshotTimer = setTimeout(() => {
    markUnavailable()
    requestInitialSnapshotFallback()
  }, INITIAL_SNAPSHOT_TIMEOUT_MS)

  void window.api.runtimeEnvironments
    .subscribe(
      {
        selector: args.environmentId,
        method: 'session.tabs.subscribeAll',
        params: {},
        timeoutMs: INITIAL_SNAPSHOT_TIMEOUT_MS,
        expectedEnvironmentPairingRevision: args.expectedEnvironmentPairingRevision
      },
      {
        onResponse: (response: RuntimeRpcResponse<unknown>) => {
          if (!isCurrent()) {
            return
          }
          if (response.ok === false) {
            console.warn(
              '[web-session-tabs-sync] global subscription failed:',
              response.error.message
            )
            markUnavailable()
            requestInitialSnapshotFallback()
            return
          }
          if (response._meta.runtimeId !== args.expectedRuntimeId) {
            markUnavailable()
            requestInitialSnapshotFallback()
            return
          }
          const replayed = isRuntimeSubscriptionReplayResponse(response)
          if (isSessionTabsSnapshotsEvent(response.result)) {
            const recoveryRevision = ++coverageRevision
            hasReadyCoverage = false
            publishedServicedActiveContext = null
            pendingServicedActiveContext = null
            receivedInitialSnapshots = true
            clearTimeout(initialSnapshotTimer)
            void applySnapshots(
              response.result.snapshots.map((snapshot) => ({
                snapshot,
                type: 'snapshot' as const
              })),
              { replayed, recoveryRevision }
            )
              .then((servicedActiveContext) => {
                if (isRecoveryCurrent(recoveryRevision)) {
                  const pendingCurrentContext =
                    pendingServicedActiveContext === args.activeContextRef.current
                      ? pendingServicedActiveContext
                      : null
                  const effectiveServicedActiveContext =
                    servicedActiveContext ?? pendingCurrentContext
                  hasReadyCoverage = true
                  pendingServicedActiveContext = null
                  publishedServicedActiveContext = effectiveServicedActiveContext
                  args.onCoverage({
                    status: 'ready',
                    servicedActiveContext: effectiveServicedActiveContext
                  })
                }
              })
              .catch((error) => {
                if (isRecoveryCurrent(recoveryRevision)) {
                  console.warn('[web-session-tabs-sync] snapshot recovery failed:', error)
                  markUnavailable()
                }
              })
            return
          }
          if (!isSessionTabsSnapshotEvent(response.result)) {
            markUnavailable()
            requestInitialSnapshotFallback()
            return
          }
          if (!receivedInitialSnapshots) {
            markUnavailable()
            requestInitialSnapshotFallback()
          }
          const recoveryRevision = coverageRevision
          void applySnapshots([{ snapshot: response.result, type: response.result.type }], {
            replayed,
            recoveryRevision
          })
            .then((servicedActiveContext) => {
              if (
                !isRecoveryCurrent(recoveryRevision) ||
                !servicedActiveContext ||
                servicedActiveContext !== args.activeContextRef.current
              ) {
                return
              }
              if (!hasReadyCoverage) {
                pendingServicedActiveContext = servicedActiveContext
                return
              }
              if (servicedActiveContext !== publishedServicedActiveContext) {
                publishedServicedActiveContext = servicedActiveContext
                args.onCoverage({ status: 'ready', servicedActiveContext })
              }
            })
            .catch((error) => {
              if (isRecoveryCurrent(recoveryRevision)) {
                console.warn('[web-session-tabs-sync] snapshot recovery failed:', error)
              }
            })
        },
        onError: (error) => {
          if (!isCurrent()) {
            return
          }
          console.warn('[web-session-tabs-sync] global subscription error:', error.message)
          markUnavailable()
          requestInitialSnapshotFallback()
        },
        onClose: () => {
          markUnavailable()
          requestInitialSnapshotFallback()
        }
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
          '[web-session-tabs-sync] failed to subscribe globally:',
          error instanceof Error ? error.message : String(error)
        )
        markUnavailable()
        requestInitialSnapshotFallback()
      }
    })

  return () => {
    disposed = true
    coverageRevision += 1
    clearTimeout(initialSnapshotTimer)
    unsubscribe?.()
  }
}
