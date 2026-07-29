import { createContext, useContext, type ReactNode } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileConnectionPath } from '../transport/stable-logical-rpc-client'
import type { ConnectionState, HostProfile } from '../transport/types'

export type RpcClientContextValue = {
  acquire: (hostId: string, host?: HostProfile) => RpcClient | null
  release: (hostId: string) => void
  forceReconnect: (hostId: string) => Promise<void>
  closeHost: (hostId: string) => void
  getState: (hostId: string) => ConnectionState
  getReconnectAttempt: (hostId: string) => number
  getLastConnectedAt: (hostId: string) => number | null
  getActivePath: (hostId: string) => MobileConnectionPath
  subscribeHostState: (hostId: string, listener: (state: ConnectionState) => void) => () => void
  getAllClients: () => Array<{ hostId: string; client: RpcClient }>
  subscribeAllHosts: (listener: () => void) => () => void
  primeHosts: (hosts: HostProfile[]) => void
}

const noop = () => {}
const value: RpcClientContextValue = {
  acquire: () => null,
  release: noop,
  async forceReconnect() {},
  closeHost: noop,
  getState: () => 'disconnected',
  getReconnectAttempt: () => 0,
  getLastConnectedAt: () => null,
  getActivePath: () => 'lan',
  subscribeHostState: () => noop,
  getAllClients: () => [],
  subscribeAllHosts: () => noop,
  primeHosts: noop
}
const Ctx = createContext<RpcClientContextValue | null>(null)
const disconnectedClient = { client: null, state: 'disconnected' } as const

export function RpcClientProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRpcClientContext(): RpcClientContextValue {
  const context = useContext(Ctx)
  if (!context) {
    throw new Error('Hosted client context provider unavailable')
  }
  return context
}

export function useHostClient(_hostId: string | undefined): {
  client: RpcClient | null
  state: ConnectionState
} {
  useRpcClientContext()
  return disconnectedClient
}

export function useAllHostClients(_hostIds: string[]): Array<{
  hostId: string
  client: RpcClient
  state: ConnectionState
  path: MobileConnectionPath
}> {
  useRpcClientContext()
  return []
}

export function useCloseHost(): (hostId: string) => void {
  return useRpcClientContext().closeHost
}

export function useForceReconnect(): (hostId: string) => Promise<void> {
  return useRpcClientContext().forceReconnect
}

export function usePrimeHosts(): (hosts: HostProfile[]) => void {
  return useRpcClientContext().primeHosts
}
