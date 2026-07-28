import { useCallback, useEffect, useState } from 'react'
import type { MobileWebFileDirectoryResult } from '../../shared/mobile-web/bridge-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'

type DirectoryState = {
  client: MobileWebBridgeClient
  workspaceId: string
  relativePath: string
  loading: boolean
  result: MobileWebFileDirectoryResult | null
  error: MobileWebBridgeClientError | null
}

export type MobileWebDirectoryView = {
  relativePath: string
  loading: boolean
  result: MobileWebFileDirectoryResult | null
  error: MobileWebBridgeClientError | null
}

export function useMobileWebFileDirectory(args: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
}): MobileWebDirectoryView & {
  navigate: (relativePath: string) => void
  retry: () => void
} {
  const { client, workspaceId, connected } = args
  const [relativePath, navigate] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const [state, setState] = useState<DirectoryState>({
    client,
    workspaceId,
    relativePath,
    loading: false,
    result: null,
    error: null
  })

  useEffect(() => {
    navigate('')
  }, [client, workspaceId])

  useEffect(() => {
    if (!connected) {
      setState((current) => ({ ...current, loading: false }))
      return
    }
    const controller = new AbortController()
    setState((current) => ({
      client,
      workspaceId,
      relativePath,
      loading: true,
      result: matchesDirectory(current, client, workspaceId, relativePath) ? current.result : null,
      error: null
    }))
    void client
      .fileDirectory({ workspaceId, relativePath, limit: 128 }, { signal: controller.signal })
      .then((result) => {
        if (
          result.workspaceId !== workspaceId ||
          result.relativePath !== relativePath ||
          controller.signal.aborted
        ) {
          if (!controller.signal.aborted) {
            throw new MobileWebBridgeClientError('invalid_message', false)
          }
          return
        }
        setState((current) => ({
          client,
          workspaceId,
          relativePath,
          loading: false,
          result:
            matchesDirectory(current, client, workspaceId, relativePath) &&
            current.result?.revision === result.revision
              ? current.result
              : result,
          error: null
        }))
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState((current) => ({
            client,
            workspaceId,
            relativePath,
            loading: false,
            result: matchesDirectory(current, client, workspaceId, relativePath)
              ? current.result
              : null,
            error: bridgeClientError(error)
          }))
        }
      })
    return () => controller.abort()
  }, [client, connected, relativePath, retryCount, workspaceId])

  const retry = useCallback(() => setRetryCount((value) => value + 1), [])
  const matches = matchesDirectory(state, client, workspaceId, relativePath)
  return {
    relativePath,
    loading: matches ? state.loading : connected,
    result: matches ? state.result : null,
    error: matches ? state.error : null,
    navigate,
    retry
  }
}

function matchesDirectory(
  state: DirectoryState,
  client: MobileWebBridgeClient,
  workspaceId: string,
  relativePath: string
): boolean {
  return (
    state.client === client &&
    state.workspaceId === workspaceId &&
    state.relativePath === relativePath
  )
}

function bridgeClientError(error: unknown): MobileWebBridgeClientError {
  return error instanceof MobileWebBridgeClientError
    ? error
    : new MobileWebBridgeClientError('internal', false)
}
