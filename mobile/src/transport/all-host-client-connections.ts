import { useEffect, useMemo, useState } from 'react'
import type { RpcClient } from './rpc-client'
import type { MobileConnectionPath } from './stable-logical-rpc-client'
import type { ConnectionState } from './types'
import { useRpcClientContext } from './client-context'

type UseAllHostClientsOptions = {
  autoConnectHostIds?: readonly string[]
}

export function useAllHostClients(hostIds: string[], options?: UseAllHostClientsOptions) {
  const ctx = useRpcClientContext()
  const autoConnectHostIds = options?.autoConnectHostIds ?? hostIds
  const key = useMemo(
    () => `${[...hostIds].sort().join(',')}|${[...autoConnectHostIds].sort().join(',')}`,
    [autoConnectHostIds, hostIds]
  )
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (hostIds.length === 0) {
      return
    }
    const trackedHostIds = new Set(hostIds)
    const acquiredHostIds = autoConnectHostIds.filter((id) => trackedHostIds.has(id))
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
        ctx.release(id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick])
}
