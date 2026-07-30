import { useEffect, useRef } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { LoadStatusOptions } from './mobile-source-control-screen-state'

type InitialLoadInput = {
  client: RpcClient | null
  connState: ConnectionState
  statusIdentityKey: string
  loadStatus: (options?: LoadStatusOptions, preferRepositorySnapshot?: boolean) => Promise<boolean>
}

export function useMobileSourceControlInitialLoad(input: InitialLoadInput): void {
  const initialLoadRef = useRef<{
    client: RpcClient | null
    statusIdentityKey: string
    connState: ConnectionState
    usedRepositorySnapshot: boolean
  } | null>(null)

  useEffect(() => {
    const current = initialLoadRef.current
    const sameContext =
      current?.client === input.client && current.statusIdentityKey === input.statusIdentityKey
    if (sameContext && current.connState === input.connState) {
      return
    }
    const preferRepositorySnapshot =
      input.client !== null &&
      input.connState === 'connected' &&
      !(sameContext && current.usedRepositorySnapshot)
    initialLoadRef.current = {
      client: input.client,
      statusIdentityKey: input.statusIdentityKey,
      connState: input.connState,
      usedRepositorySnapshot:
        preferRepositorySnapshot || (sameContext && current.usedRepositorySnapshot)
    }
    void input.loadStatus(undefined, preferRepositorySnapshot)
  }, [input.client, input.connState, input.loadStatus, input.statusIdentityKey])
}
