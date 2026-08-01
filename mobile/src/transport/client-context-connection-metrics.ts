import { useEffect, useState } from 'react'
import { useRpcClientContext } from './rpc-client-react-context'
import type { RpcClientContextValue } from './rpc-client-context-contract'

const RPC_UNRESPONSIVE_POLL_MS = 1_000

export function useReconnectAttempt(hostId: string | undefined): number {
  return useHostMetric(hostId, (context, id) => context.getReconnectAttempt(id), 0)
}

export function useLastConnectedAt(hostId: string | undefined): number | null {
  return useHostMetric(hostId, (context, id) => context.getLastConnectedAt(id), null)
}

export function useRpcUnresponsiveSince(hostId: string | undefined): number | null {
  return useHostMetric(hostId, (context, id) => context.getRpcUnresponsiveSince(id), null, {
    pollMs: RPC_UNRESPONSIVE_POLL_MS
  })
}

export function useConnectionHealthInputs(hostId: string | undefined) {
  return {
    reconnectAttempts: useReconnectAttempt(hostId),
    lastConnectedAt: useLastConnectedAt(hostId),
    rpcUnresponsiveSince: useRpcUnresponsiveSince(hostId)
  }
}

export function useRpcUnresponsiveByHost(hostIds: string[]): Record<string, number | null> {
  const context = useRpcClientContext()
  const [values, setValues] = useState<Record<string, number | null>>({})
  const hostKey = hostIds.join('\u0000')
  useEffect(() => {
    const read = () => {
      setValues(Object.fromEntries(hostIds.map((id) => [id, context.getRpcUnresponsiveSince(id)])))
    }
    read()
    const interval = setInterval(read, RPC_UNRESPONSIVE_POLL_MS)
    return () => clearInterval(interval)
  }, [context, hostIds, hostKey])
  return values
}

function useHostMetric<T>(
  hostId: string | undefined,
  read: (context: RpcClientContextValue, hostId: string) => T,
  fallback: T,
  options: { pollMs?: number } = {}
): T {
  const context = useRpcClientContext()
  const [, force] = useState(0)
  useEffect(() => {
    if (!hostId) {
      return
    }
    const unsubscribe = context.subscribeHostState(hostId, () => force((count) => count + 1))
    const interval = options.pollMs
      ? setInterval(() => force((count) => count + 1), options.pollMs)
      : null
    return () => {
      unsubscribe()
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [context, hostId, options.pollMs])
  return hostId ? read(context, hostId) : fallback
}
