import { useEffect, useMemo, useRef, useState } from 'react'
import type { RpcClient } from './rpc-client'
import type { MobileConnectionPath } from './stable-logical-rpc-client'
import type { ConnectionState } from './types'
import { useRpcClientContext } from './client-context'

type UseAllHostClientsOptions = {
  autoConnectHostIds?: readonly string[]
  closeUnusedOnRelease?: boolean
}

export function useAllHostClients(hostIds: string[], options?: UseAllHostClientsOptions) {
  const ctx = useRpcClientContext()
  const autoConnectHostIds = options?.autoConnectHostIds ?? hostIds
  const closeUnusedOnRelease = options?.closeUnusedOnRelease ?? false
  const key = useMemo(
    () =>
      [
        [...hostIds].sort().join(','),
        [...autoConnectHostIds].sort().join(','),
        closeUnusedOnRelease ? 'close' : 'keep'
      ].join('|'),
    [autoConnectHostIds, closeUnusedOnRelease, hostIds]
  )
  const [tick, setTick] = useState(0)
  const acquiredHostIdsRef = useRef<Set<string>>(new Set())
  const hostUnsubscribesRef = useRef<Map<string, () => void>>(new Map())
  const closeUnusedRef = useRef(closeUnusedOnRelease)
  closeUnusedRef.current = closeUnusedOnRelease

  useEffect(() => {
    const unsubscribeAllHosts = ctx.subscribeAllHosts(() => setTick((value) => value + 1))
    return () => {
      unsubscribeAllHosts()
      for (const unsubscribe of hostUnsubscribesRef.current.values()) {
        unsubscribe()
      }
      hostUnsubscribesRef.current.clear()
      for (const id of acquiredHostIdsRef.current) {
        if (closeUnusedRef.current) {
          ctx.releaseAndCloseIfUnused(id)
        } else {
          ctx.release(id)
        }
      }
      acquiredHostIdsRef.current.clear()
    }
  }, [ctx])

  useEffect(() => {
    const trackedHostIds = new Set(hostIds)
    const nextAcquiredHostIds = new Set(autoConnectHostIds.filter((id) => trackedHostIds.has(id)))

    for (const [id, unsubscribe] of hostUnsubscribesRef.current) {
      if (!trackedHostIds.has(id)) {
        unsubscribe()
        hostUnsubscribesRef.current.delete(id)
      }
    }
    for (const id of trackedHostIds) {
      if (!hostUnsubscribesRef.current.has(id)) {
        hostUnsubscribesRef.current.set(
          id,
          ctx.subscribeHostState(id, () => setTick((value) => value + 1))
        )
      }
    }

    for (const id of acquiredHostIdsRef.current) {
      if (!nextAcquiredHostIds.has(id)) {
        if (closeUnusedOnRelease) {
          ctx.releaseAndCloseIfUnused(id)
        } else {
          ctx.release(id)
        }
      }
    }
    for (const id of nextAcquiredHostIds) {
      if (!acquiredHostIdsRef.current.has(id)) {
        ctx.acquire(id)
      }
    }
    acquiredHostIdsRef.current = nextAcquiredHostIds
  }, [ctx, key])

  return useMemo(() => {
    const clientsByHostId = new Map(
      ctx.getAllClients().map((entry) => [entry.hostId, entry.client])
    )
    return hostIds.flatMap<{
      hostId: string
      client: RpcClient
      state: ConnectionState
      path: MobileConnectionPath
    }>((hostId) => {
      const client = clientsByHostId.get(hostId)
      return client
        ? [{ hostId, client, state: ctx.getState(hostId), path: ctx.getActivePath(hostId) }]
        : []
    })
  }, [ctx, hostIds, tick])
}
