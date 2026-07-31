import { useEffect, useMemo, useState } from 'react'
import type { RpcClient } from './rpc-client'
import type { MobileConnectionPath } from './stable-logical-rpc-client'
import type { ConnectionState } from './types'
import { useRpcClientContext } from './client-context'

type UseAllHostClientsOptions = {
  autoConnectHostIds?: readonly string[]
  closeUnusedOnUnmount?: boolean
  preserveHostIdsOnUnmount?: readonly string[]
}

export function useAllHostClients(hostIds: string[], options?: UseAllHostClientsOptions) {
  const ctx = useRpcClientContext()
  const autoConnectHostIds = options?.autoConnectHostIds ?? hostIds
  const closeUnusedOnUnmount = options?.closeUnusedOnUnmount ?? false
  const preserveHostIdsOnUnmount = options?.preserveHostIdsOnUnmount ?? []
  const key = useMemo(
    () =>
      [
        [...hostIds].sort().join(','),
        [...autoConnectHostIds].sort().join(','),
        closeUnusedOnUnmount ? 'close' : 'keep',
        [...preserveHostIdsOnUnmount].sort().join(',')
      ].join('|'),
    [autoConnectHostIds, closeUnusedOnUnmount, hostIds, preserveHostIdsOnUnmount]
  )
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (hostIds.length === 0) {
      return
    }
    const trackedHostIds = new Set(hostIds)
    const acquiredHostIds = autoConnectHostIds.filter((id) => trackedHostIds.has(id))
    const preservedHostIds = new Set(preserveHostIdsOnUnmount)
    for (const id of acquiredHostIds) {
      ctx.acquire(id)
    }
    const unsubs = hostIds.map((id) =>
      ctx.subscribeHostState(id, () => setTick((value) => value + 1))
    )
    unsubs.push(ctx.subscribeAllHosts(() => setTick((value) => value + 1)))
    return () => {
      for (const unsubscribe of unsubs) {
        unsubscribe()
      }
      for (const id of acquiredHostIds) {
        if (closeUnusedOnUnmount && !preservedHostIds.has(id)) {
          ctx.releaseAndCloseIfUnused(id)
        } else {
          ctx.release(id)
        }
      }
    }
  }, [key])

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
  }, [key, tick])
}
