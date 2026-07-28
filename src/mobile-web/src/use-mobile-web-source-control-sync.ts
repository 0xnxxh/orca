import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  MobileWebSourceControlRepositoryState,
  MobileWebSourceControlSyncOperation
} from '../../shared/mobile-web/source-control-sync-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'

export type MobileWebSourceControlPendingAction =
  | { kind: 'checkout'; branch: string }
  | { kind: 'pull'; strategy: 'fast-forward' | 'merge' }
  | { kind: 'push'; mode: 'push' | 'publish' }
  | { kind: 'rebase'; baseRef: string }
  | { kind: 'abort'; conflictOperation: 'merge' | 'rebase' }

type SyncAction = MobileWebSourceControlPendingAction | { kind: 'fetch' }

type SyncState = {
  client: MobileWebBridgeClient
  workspaceId: string
  loading: boolean
  repository: MobileWebSourceControlRepositoryState | null
  busy: MobileWebSourceControlSyncOperation | null
  pending: MobileWebSourceControlPendingAction | null
  error: MobileWebBridgeClientError | null
}

export function useMobileWebSourceControlSync(args: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
  onRepositoryChanged: () => void
}) {
  const { client, workspaceId, connected, onRepositoryChanged } = args
  const actionController = useRef<AbortController | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)
  const [state, setState] = useState<SyncState>(() => emptyState(client, workspaceId))

  useEffect(() => {
    if (!connected) {
      actionController.current?.abort()
      actionController.current = null
      setState((current) =>
        matchesSync(current, client, workspaceId)
          ? { ...current, loading: false, busy: null, pending: null }
          : current
      )
      return
    }
    const controller = new AbortController()
    setState((current) => ({
      ...emptyState(client, workspaceId),
      loading: true,
      repository: matchesSync(current, client, workspaceId) ? current.repository : null,
      pending: matchesSync(current, client, workspaceId) ? current.pending : null
    }))
    void client.sourceControlUpstream({ workspaceId }, { signal: controller.signal }).then(
      (repository) => {
        if (!controller.signal.aborted) {
          setState((current) => ({
            ...emptyState(client, workspaceId),
            repository,
            pending: matchesSync(current, client, workspaceId) ? current.pending : null
          }))
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState((current) => ({
            ...emptyState(client, workspaceId),
            repository: matchesSync(current, client, workspaceId) ? current.repository : null,
            error: bridgeError(error)
          }))
        }
      }
    )
    return () => controller.abort()
  }, [client, connected, refreshCount, workspaceId])

  useEffect(
    () => () => {
      actionController.current?.abort()
      actionController.current = null
    },
    [client, workspaceId]
  )

  const matches = matchesSync(state, client, workspaceId)
  const visible = matches ? state : emptyState(client, workspaceId)

  const run = useCallback(
    async (action: SyncAction): Promise<boolean> => {
      const repository = matches ? state.repository : null
      if (!connected || !repository || actionController.current) {
        return false
      }
      const controller = new AbortController()
      actionController.current = controller
      const operation = operationForAction(action)
      setState((current) =>
        matchesSync(current, client, workspaceId)
          ? { ...current, busy: operation, pending: null, error: null }
          : current
      )
      try {
        const identity = {
          workspaceId,
          expectedHead: repository.head,
          expectedBranch: repository.branch
        }
        const expectedUpstream = repository.upstream
        const result =
          action.kind === 'fetch'
            ? await client.sourceControlFetch(identity, { signal: controller.signal })
            : action.kind === 'checkout'
              ? await client.sourceControlCheckout(
                  {
                    ...identity,
                    branch: action.branch,
                    confirmation: 'checkout-confirmed'
                  },
                  { signal: controller.signal }
                )
              : action.kind === 'pull'
                ? await client.sourceControlPull(
                    {
                      ...identity,
                      expectedUpstream,
                      strategy: action.strategy,
                      confirmation: 'pull-confirmed'
                    },
                    { signal: controller.signal }
                  )
                : action.kind === 'push'
                  ? await client.sourceControlPush(
                      {
                        ...identity,
                        expectedUpstream,
                        mode: action.mode,
                        confirmation: 'push-confirmed'
                      },
                      { signal: controller.signal }
                    )
                  : action.kind === 'rebase'
                    ? await client.sourceControlRebase(
                        {
                          ...identity,
                          expectedUpstream,
                          baseRef: action.baseRef,
                          confirmation: 'rebase-confirmed'
                        },
                        { signal: controller.signal }
                      )
                    : await client.sourceControlAbort(
                        {
                          ...identity,
                          conflictOperation: action.conflictOperation,
                          confirmation: 'abort-confirmed'
                        },
                        { signal: controller.signal }
                      )
        if (controller.signal.aborted) {
          return false
        }
        setState((current) =>
          matchesSync(current, client, workspaceId)
            ? {
                ...current,
                repository: result.repository ?? current.repository,
                busy: null,
                pending: null,
                error: null
              }
            : current
        )
        setRefreshCount((value) => value + 1)
        onRepositoryChanged()
        return true
      } catch (error) {
        if (controller.signal.aborted) {
          return false
        }
        const nextError = bridgeError(error)
        setState((current) =>
          matchesSync(current, client, workspaceId)
            ? { ...current, busy: null, pending: null, error: nextError }
            : current
        )
        if (nextError.code === 'conflict') {
          setRefreshCount((value) => value + 1)
          onRepositoryChanged()
        }
        return false
      } finally {
        if (actionController.current === controller) {
          actionController.current = null
        }
      }
    },
    [client, connected, matches, onRepositoryChanged, state.repository, workspaceId]
  )

  return {
    ...visible,
    loading: matches ? state.loading : connected,
    retry: useCallback(() => setRefreshCount((value) => value + 1), []),
    fetch: useCallback(() => run({ kind: 'fetch' }), [run]),
    requestCheckout: useCallback(
      (branch: string) =>
        requestPending(setState, client, workspaceId, { kind: 'checkout', branch }),
      [client, workspaceId]
    ),
    requestPull: useCallback(() => {
      const upstream = visible.repository?.upstream
      if (upstream?.hasUpstream && upstream.behind > 0) {
        requestPending(setState, client, workspaceId, {
          kind: 'pull',
          strategy: upstream.ahead === 0 ? 'fast-forward' : 'merge'
        })
      }
    }, [client, visible.repository, workspaceId]),
    requestPush: useCallback(() => {
      const upstream = visible.repository?.upstream
      if (!upstream) {
        return
      }
      const mode = upstream.hasUpstream || upstream.hasConfiguredPushTarget ? 'push' : 'publish'
      requestPending(setState, client, workspaceId, { kind: 'push', mode })
    }, [client, visible.repository, workspaceId]),
    requestRebase: useCallback(() => {
      const baseRef = visible.repository?.baseRef
      if (baseRef) {
        requestPending(setState, client, workspaceId, { kind: 'rebase', baseRef })
      }
    }, [client, visible.repository, workspaceId]),
    requestAbort: useCallback(() => {
      const operation = visible.repository?.conflictOperation
      if (operation === 'merge' || operation === 'rebase') {
        requestPending(setState, client, workspaceId, {
          kind: 'abort',
          conflictOperation: operation
        })
      }
    }, [client, visible.repository, workspaceId]),
    confirmPending: useCallback(
      () => (visible.pending ? run(visible.pending) : Promise.resolve(false)),
      [run, visible.pending]
    ),
    cancelPending: useCallback(
      () =>
        setState((current) =>
          matchesSync(current, client, workspaceId) && !current.busy
            ? { ...current, pending: null }
            : current
        ),
      [client, workspaceId]
    ),
    clearError: useCallback(
      () =>
        setState((current) =>
          matchesSync(current, client, workspaceId) ? { ...current, error: null } : current
        ),
      [client, workspaceId]
    )
  }
}

function requestPending(
  setState: React.Dispatch<React.SetStateAction<SyncState>>,
  client: MobileWebBridgeClient,
  workspaceId: string,
  pending: MobileWebSourceControlPendingAction
): void {
  setState((current) =>
    matchesSync(current, client, workspaceId) && !current.busy
      ? { ...current, pending, error: null }
      : current
  )
}

function operationForAction(action: SyncAction): MobileWebSourceControlSyncOperation {
  return action.kind === 'checkout' ? 'branch' : action.kind
}

function emptyState(client: MobileWebBridgeClient, workspaceId: string): SyncState {
  return {
    client,
    workspaceId,
    loading: false,
    repository: null,
    busy: null,
    pending: null,
    error: null
  }
}

function matchesSync(
  state: SyncState,
  client: MobileWebBridgeClient,
  workspaceId: string
): boolean {
  return state.client === client && state.workspaceId === workspaceId
}

function bridgeError(error: unknown): MobileWebBridgeClientError {
  return error instanceof MobileWebBridgeClientError
    ? error
    : new MobileWebBridgeClientError('internal', false)
}

export type MobileWebSourceControlSync = ReturnType<typeof useMobileWebSourceControlSync>
