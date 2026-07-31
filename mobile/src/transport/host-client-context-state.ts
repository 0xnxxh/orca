import type { RpcClient } from './rpc-client'
import type { MobileConnectionPath, StableLogicalRpcClient } from './stable-logical-rpc-client'
import type { ConnectionState } from './types'

export type CloseEntryOptions = {
  forgetPrimedHost: boolean
  preserveAcquisitions: boolean
}

export function notifyHostStateListeners(
  listeners: Map<string, Set<(state: ConnectionState) => void>>,
  hostId: string,
  state: ConnectionState
): void {
  for (const listener of listeners.get(hostId) ?? []) {
    listener(state)
  }
}

export function notifyAllHostListeners(listeners: Set<() => void>): void {
  for (const listener of listeners) {
    listener()
  }
}

export function clientActivePath(client: RpcClient | undefined): MobileConnectionPath {
  const logical = client as Partial<StableLogicalRpcClient> | undefined
  return typeof logical?.getActivePath === 'function' ? logical.getActivePath() : 'lan'
}
