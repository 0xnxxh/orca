import { useCallback, useEffect, useRef, useState } from 'react'
import type { MobileWebSessionSnapshotResult } from '../../shared/mobile-web/bridge-operation-contract'
import { MobileWebBridgeClientError, type MobileWebBridgeClient } from './mobile-web-bridge-client'

export type MobileWebSessionPendingAction =
  | 'create'
  | `activate:${string}`
  | `close:${string}`
  | null

export function useMobileWebSessionActions(args: {
  client: MobileWebBridgeClient
  connected: boolean
  workspaceId: string
  onSnapshot: (snapshot: MobileWebSessionSnapshotResult, allowSameVersion: boolean) => void
}): {
  pending: MobileWebSessionPendingAction
  error: MobileWebBridgeClientError | null
  activate: (tabId: string) => void
  create: () => void
  close: (tabId: string) => void
} {
  const { client, connected, workspaceId, onSnapshot } = args
  const [pending, setPending] = useState<MobileWebSessionPendingAction>(null)
  const [error, setError] = useState<MobileWebBridgeClientError | null>(null)
  const context = useRef<{ client: MobileWebBridgeClient; workspaceId: string } | null>({
    client,
    workspaceId
  })

  useEffect(() => {
    const current = { client, workspaceId }
    context.current = current
    setPending(null)
    setError(null)
    return () => {
      if (context.current === current) {
        context.current = null
      }
    }
  }, [client, workspaceId])

  const isCurrent = useCallback(
    () => context.current?.client === client && context.current.workspaceId === workspaceId,
    [client, workspaceId]
  )

  const refresh = useCallback(async () => {
    try {
      const snapshot = await client.sessionSnapshot({ workspaceId })
      if (isCurrent()) {
        onSnapshot(snapshot, true)
      }
    } catch {
      // The live subscription remains authoritative when a post-mutation refresh races reconnect.
    }
  }, [client, isCurrent, onSnapshot, workspaceId])

  const run = useCallback(
    async (key: Exclude<MobileWebSessionPendingAction, null>, operation: () => Promise<void>) => {
      if (!connected || pending !== null) {
        return
      }
      setPending(key)
      setError(null)
      try {
        await operation()
      } catch (operationError) {
        if (isCurrent()) {
          setError(asBridgeError(operationError))
        }
      } finally {
        if (isCurrent()) {
          setPending(null)
        }
      }
    },
    [connected, isCurrent, pending]
  )

  const activate = useCallback(
    (tabId: string) => {
      void run(`activate:${tabId}`, async () => {
        const snapshot = await client.sessionActivate({
          workspaceId,
          tabId
        })
        if (isCurrent()) {
          onSnapshot(snapshot, true)
        }
      })
    },
    [client, isCurrent, onSnapshot, run, workspaceId]
  )

  const create = useCallback(() => {
    void run('create', async () => {
      await client.sessionCreate({ workspaceId })
      await refresh()
    })
  }, [client, refresh, run, workspaceId])

  const close = useCallback(
    (tabId: string) => {
      void run(`close:${tabId}`, async () => {
        const result = await client.sessionClose({ workspaceId, tabId })
        await refresh()
        if (result.outcome === 'refused') {
          throw new MobileWebBridgeClientError('conflict', false)
        }
      })
    },
    [client, refresh, run, workspaceId]
  )

  return { pending, error, activate, create, close }
}

function asBridgeError(error: unknown): MobileWebBridgeClientError {
  return error instanceof MobileWebBridgeClientError
    ? error
    : new MobileWebBridgeClientError('internal', false)
}
