import { useCallback, useEffect, useMemo } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { HostSessionTabOperations } from './host-session-tab-operations'
import {
  MobileSessionTabsStreamHealth,
  type SessionTabsApplyOutcome,
  type SessionTabsStreamSource
} from './mobile-session-tabs-stream-health'

type Params<Result, Tab> = {
  client: RpcClient | null
  sessionTabOperations?: HostSessionTabOperations | null
  connState: ConnectionState
  worktreeId: string
  applySessionTabs: (result: Result) => SessionTabsApplyOutcome<Tab>
  consumeAcceptedSessionTabs: (
    result: Result,
    effectiveTabs: readonly Tab[],
    source: SessionTabsStreamSource
  ) => void
  fetchTerminals: () => Promise<void>
  hasRecoveryNeed: () => boolean
  getApplicationRevision?: () => number
  onFetchStarted?: () => void
  onFetchSucceeded?: (result: Result) => void
  onFetchFailed?: (code: string) => void
  onFetchErrored?: (error: unknown) => void
}

type ResultActions = {
  fetchSessionTabs: () => Promise<void>
  ensureSessionTabs: () => Promise<void>
  fetchPendingBrowserSessionTabs: () => Promise<void>
}

const resolved = Promise.resolve()

export function useMobileSessionTabsReconciliation<Result, Tab>({
  client,
  sessionTabOperations,
  connState,
  worktreeId,
  applySessionTabs,
  consumeAcceptedSessionTabs,
  fetchTerminals,
  hasRecoveryNeed,
  getApplicationRevision,
  onFetchStarted,
  onFetchSucceeded,
  onFetchFailed,
  onFetchErrored
}: Params<Result, Tab>): ResultActions {
  const controller = useMemo(() => {
    if (!sessionTabOperations && !client) {
      return null
    }
    return new MobileSessionTabsStreamHealth<Result, Tab>({
      ...(sessionTabOperations
        ? {
            requestSnapshot: () => sessionTabOperations.snapshot(worktreeId) as Promise<Result>,
            getGeneration: () =>
              (
                client as (RpcClient & { getGeneration?: () => number }) | null
              )?.getGeneration?.() ?? 0
          }
        : { client: client as RpcClient, scope: `id:${worktreeId}` }),
      apply: applySessionTabs,
      consumeAccepted: consumeAcceptedSessionTabs,
      hasRecoveryNeed,
      getApplicationRevision,
      onFetchStarted,
      onFetchSucceeded,
      onFetchFailed: (failure) => onFetchFailed?.(failure.error.code),
      onFetchErrored
    })
  }, [
    applySessionTabs,
    client,
    consumeAcceptedSessionTabs,
    getApplicationRevision,
    hasRecoveryNeed,
    onFetchErrored,
    onFetchFailed,
    onFetchStarted,
    onFetchSucceeded,
    sessionTabOperations,
    worktreeId
  ])

  useEffect(
    () => () => {
      controller?.dispose()
    },
    [controller]
  )

  useEffect(() => {
    if ((!sessionTabOperations && !client) || !controller || connState !== 'connected') {
      return
    }
    const subscription = controller.beginSubscription()
    if (sessionTabOperations) {
      let initialSnapshotPending = true
      const unsubscribe = sessionTabOperations.subscribe(
        worktreeId,
        (snapshot) => {
          const type = initialSnapshotPending ? 'snapshot' : 'updated'
          initialSnapshotPending = false
          subscription.listener({ ...snapshot, type } as Result)
        },
        () => subscription.listener({ type: 'error' } as Result)
      )
      return () => {
        subscription.cancel()
        unsubscribe()
      }
    }
    const directClient = client as RpcClient
    const unsubscribe = directClient.subscribe(
      'session.tabs.subscribe',
      { worktree: `id:${worktreeId}` },
      subscription.listener
    )
    return () => {
      subscription.cancel()
      unsubscribe()
    }
  }, [client, connState, controller, sessionTabOperations, worktreeId])

  useFocusEffect(
    useCallback(() => {
      if (!controller || connState !== 'connected') {
        return
      }
      const refresh = (forceTabs: boolean): void => {
        if (AppState.currentState !== 'active') {
          controller.setReconciliationActive(false)
          return
        }
        controller.setReconciliationActive(true)
        if (forceTabs) {
          void controller.requestReconciliation()
        } else {
          void controller.poll()
        }
        void fetchTerminals()
      }
      const appStateSubscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          refresh(true)
        } else {
          controller.setReconciliationActive(false)
        }
      })
      const interval = setInterval(() => refresh(false), 2000)
      refresh(true)
      return () => {
        controller.setReconciliationActive(false)
        clearInterval(interval)
        appStateSubscription.remove()
      }
    }, [connState, controller, fetchTerminals])
  )

  return {
    fetchSessionTabs: useCallback(
      () => controller?.requestReconciliation() ?? resolved,
      [controller]
    ),
    ensureSessionTabs: useCallback(
      () => controller?.ensureReconciliation() ?? resolved,
      [controller]
    ),
    fetchPendingBrowserSessionTabs: useCallback(
      () => controller?.requestPendingRecovery() ?? resolved,
      [controller]
    )
  }
}
