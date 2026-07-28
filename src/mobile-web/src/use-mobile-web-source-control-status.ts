import { useCallback, useEffect, useState } from 'react'
import {
  MOBILE_WEB_SOURCE_CONTROL_STATUS_LIMIT,
  type MobileWebSourceControlStatusResult
} from '../../shared/mobile-web/source-control-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'

type StatusState = {
  client: MobileWebBridgeClient
  workspaceId: string
  loading: boolean
  result: MobileWebSourceControlStatusResult | null
  error: MobileWebBridgeClientError | null
}

const MOBILE_WEB_SOURCE_CONTROL_POLL_MS = 10_000

export function useMobileWebSourceControlStatus(args: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
}) {
  const { client, workspaceId, connected } = args
  const [refreshCount, setRefreshCount] = useState(0)
  const [liveRefresh, setLiveRefresh] = useState<
    'offline' | 'connecting' | 'active' | 'unavailable'
  >(connected ? 'connecting' : 'offline')
  const [state, setState] = useState<StatusState>({
    client,
    workspaceId,
    loading: false,
    result: null,
    error: null
  })

  useEffect(() => {
    if (!connected) {
      setState((current) => ({ ...current, loading: false }))
      return
    }
    const controller = new AbortController()
    setState((current) => ({
      client,
      workspaceId,
      loading: true,
      result: matchesStatus(current, client, workspaceId) ? current.result : null,
      error: null
    }))
    void client
      .sourceControlStatus(
        { workspaceId, limit: MOBILE_WEB_SOURCE_CONTROL_STATUS_LIMIT },
        { signal: controller.signal }
      )
      .then((result) => {
        if (controller.signal.aborted) {
          return
        }
        if (result.workspaceId !== workspaceId) {
          throw new MobileWebBridgeClientError('invalid_message', false)
        }
        setState({ client, workspaceId, loading: false, result, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState((current) => ({
            client,
            workspaceId,
            loading: false,
            result: matchesStatus(current, client, workspaceId) ? current.result : null,
            error: bridgeClientError(error)
          }))
        }
      })
    return () => controller.abort()
  }, [client, connected, refreshCount, workspaceId])

  useEffect(() => {
    if (!connected) {
      setLiveRefresh('offline')
      return
    }
    let active = true
    let refreshQueued = false
    setLiveRefresh('connecting')
    const queueRefresh = (): void => {
      if (refreshQueued) {
        return
      }
      refreshQueued = true
      queueMicrotask(() => {
        refreshQueued = false
        if (active) {
          setRefreshCount((value) => value + 1)
        }
      })
    }
    const subscription = client.sourceControlSubscribe(
      { workspaceId },
      (event) => {
        if (!active) {
          return
        }
        if (event.reason === 'unavailable') {
          setLiveRefresh('unavailable')
          return
        }
        queueRefresh()
      },
      () => {
        if (active) {
          setLiveRefresh('unavailable')
        }
      }
    )
    void subscription.ready
      .then(() => {
        if (active) {
          setLiveRefresh('active')
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [client, connected, workspaceId])

  useEffect(() => {
    if (!connected) {
      return
    }
    const refreshWhenVisible = (): void => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        setRefreshCount((value) => value + 1)
      }
    }
    const timer = setInterval(refreshWhenVisible, MOBILE_WEB_SOURCE_CONTROL_POLL_MS)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [connected])

  const matches = matchesStatus(state, client, workspaceId)
  return {
    loading: matches ? state.loading : connected,
    result: matches ? state.result : null,
    error: matches ? state.error : null,
    liveRefresh,
    retry: useCallback(() => setRefreshCount((value) => value + 1), [])
  }
}

function matchesStatus(
  state: StatusState,
  client: MobileWebBridgeClient,
  workspaceId: string
): boolean {
  return state.client === client && state.workspaceId === workspaceId
}

function bridgeClientError(error: unknown): MobileWebBridgeClientError {
  return error instanceof MobileWebBridgeClientError
    ? error
    : new MobileWebBridgeClientError('internal', false)
}
