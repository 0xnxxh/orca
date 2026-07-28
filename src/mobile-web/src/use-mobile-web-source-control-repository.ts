import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MOBILE_WEB_SOURCE_CONTROL_HISTORY_DEFAULT_LIMIT,
  MOBILE_WEB_SOURCE_CONTROL_HISTORY_MAX_LIMIT,
  type MobileWebSourceControlBranchCompareResult,
  type MobileWebSourceControlBranchesResult,
  type MobileWebSourceControlCommitCompareResult,
  type MobileWebSourceControlHistoryItem,
  type MobileWebSourceControlHistoryResult
} from '../../shared/mobile-web/source-control-history-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import { useMobileWebSourceControlSync } from './use-mobile-web-source-control-sync'

export type MobileWebRepositorySelection =
  | { kind: 'branch'; id: string; label: string }
  | { kind: 'commit'; id: string; label: string }

export type MobileWebRepositoryComparison =
  | MobileWebSourceControlBranchCompareResult
  | MobileWebSourceControlCommitCompareResult

type RepositoryState = {
  client: MobileWebBridgeClient
  workspaceId: string
  loading: boolean
  branches: MobileWebSourceControlBranchesResult | null
  history: MobileWebSourceControlHistoryResult | null
  error: MobileWebBridgeClientError | null
  selection: MobileWebRepositorySelection | null
  comparison: MobileWebRepositoryComparison | null
  comparisonLoading: boolean
  comparisonError: MobileWebBridgeClientError | null
}

export function useMobileWebSourceControlRepository(args: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
  onRepositoryChanged: () => void
}) {
  const { client, workspaceId, connected, onRepositoryChanged } = args
  const comparisonController = useRef<AbortController | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)
  const [historyLimit, setHistoryLimit] = useState(MOBILE_WEB_SOURCE_CONTROL_HISTORY_DEFAULT_LIMIT)
  const [state, setState] = useState<RepositoryState>(() =>
    emptyRepositoryState(client, workspaceId)
  )
  const retry = useCallback(() => setRefreshCount((value) => value + 1), [])
  const sync = useMobileWebSourceControlSync({
    client,
    workspaceId,
    connected,
    onRepositoryChanged: useCallback(() => {
      retry()
      onRepositoryChanged()
    }, [onRepositoryChanged, retry])
  })

  useEffect(() => {
    if (!connected) {
      comparisonController.current?.abort()
      comparisonController.current = null
      setState((current) =>
        matchesRepository(current, client, workspaceId)
          ? { ...current, loading: false, comparisonLoading: false }
          : current
      )
      return
    }
    const controller = new AbortController()
    setState((current) => ({
      ...emptyRepositoryState(client, workspaceId),
      loading: true,
      branches: matchesRepository(current, client, workspaceId) ? current.branches : null,
      history: matchesRepository(current, client, workspaceId) ? current.history : null
    }))
    void Promise.all([
      client.sourceControlBranches({ workspaceId }, { signal: controller.signal }),
      client.sourceControlHistory(
        { workspaceId, limit: historyLimit },
        { signal: controller.signal }
      )
    ]).then(
      ([branches, history]) => {
        if (!controller.signal.aborted) {
          setState({
            ...emptyRepositoryState(client, workspaceId),
            branches,
            history
          })
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState((current) => ({
            ...emptyRepositoryState(client, workspaceId),
            branches: matchesRepository(current, client, workspaceId) ? current.branches : null,
            history: matchesRepository(current, client, workspaceId) ? current.history : null,
            error: bridgeClientError(error)
          }))
        }
      }
    )
    return () => controller.abort()
  }, [client, connected, historyLimit, refreshCount, workspaceId])

  useEffect(
    () => () => {
      comparisonController.current?.abort()
      comparisonController.current = null
    },
    [client, workspaceId]
  )

  const requestComparison = useCallback(
    (selection: MobileWebRepositorySelection) => {
      if (!connected) {
        return
      }
      comparisonController.current?.abort()
      const controller = new AbortController()
      comparisonController.current = controller
      setState((current) => ({
        ...current,
        selection,
        comparison: null,
        comparisonLoading: true,
        comparisonError: null
      }))
      const request =
        selection.kind === 'branch'
          ? client.sourceControlBranchCompare(
              { workspaceId, baseRef: selection.id },
              { signal: controller.signal }
            )
          : client.sourceControlCommitCompare(
              { workspaceId, commitId: selection.id },
              { signal: controller.signal }
            )
      void request.then(
        (comparison) => {
          if (!controller.signal.aborted) {
            setState((current) =>
              acceptsComparison(current, client, workspaceId, selection)
                ? { ...current, comparison, comparisonLoading: false, comparisonError: null }
                : current
            )
          }
        },
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setState((current) =>
              acceptsComparison(current, client, workspaceId, selection)
                ? {
                    ...current,
                    comparison: null,
                    comparisonLoading: false,
                    comparisonError: bridgeClientError(error)
                  }
                : current
            )
          }
        }
      )
    },
    [client, connected, workspaceId]
  )

  const matches = matchesRepository(state, client, workspaceId)
  const visible = matches ? state : emptyRepositoryState(client, workspaceId)
  return {
    ...visible,
    sync,
    loading: matches ? state.loading : connected,
    retry,
    compareBranch: useCallback(
      (branch: string) => requestComparison({ kind: 'branch', id: branch, label: branch }),
      [requestComparison]
    ),
    compareCommit: useCallback(
      (commit: MobileWebSourceControlHistoryItem) =>
        requestComparison({ kind: 'commit', id: commit.id, label: commit.subject }),
      [requestComparison]
    ),
    retryComparison: useCallback(() => {
      if (matches && state.selection) {
        requestComparison(state.selection)
      }
    }, [matches, requestComparison, state.selection]),
    loadMoreHistory: useCallback(
      () =>
        setHistoryLimit((limit) =>
          Math.min(
            MOBILE_WEB_SOURCE_CONTROL_HISTORY_MAX_LIMIT,
            limit + MOBILE_WEB_SOURCE_CONTROL_HISTORY_DEFAULT_LIMIT
          )
        ),
      []
    ),
    canLoadMoreHistory:
      visible.history?.hasMore === true &&
      visible.history.limit < MOBILE_WEB_SOURCE_CONTROL_HISTORY_MAX_LIMIT
  }
}

function emptyRepositoryState(client: MobileWebBridgeClient, workspaceId: string): RepositoryState {
  return {
    client,
    workspaceId,
    loading: false,
    branches: null,
    history: null,
    error: null,
    selection: null,
    comparison: null,
    comparisonLoading: false,
    comparisonError: null
  }
}

function matchesRepository(
  state: RepositoryState,
  client: MobileWebBridgeClient,
  workspaceId: string
): boolean {
  return state.client === client && state.workspaceId === workspaceId
}

function acceptsComparison(
  state: RepositoryState,
  client: MobileWebBridgeClient,
  workspaceId: string,
  selection: MobileWebRepositorySelection
): boolean {
  return (
    matchesRepository(state, client, workspaceId) &&
    state.selection?.kind === selection.kind &&
    state.selection.id === selection.id
  )
}

function bridgeClientError(error: unknown): MobileWebBridgeClientError {
  return error instanceof MobileWebBridgeClientError
    ? error
    : new MobileWebBridgeClientError('internal', false)
}
