import { useEffect, useRef } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'

type InitialLoadInput = {
  client: RpcClient | null
  connState: ConnectionState
  hostId: string
  worktreeId: string
  loadReviewData: (preferRepositorySnapshot?: boolean) => Promise<void>
}

export function useMobileDiffReviewInitialLoad(input: InitialLoadInput): void {
  const initialLoadRef = useRef<{
    client: RpcClient | null
    contextKey: string
    connState: ConnectionState
    usedRepositorySnapshot: boolean
  } | null>(null)

  useEffect(() => {
    const contextKey = `${input.hostId}\0${input.worktreeId}`
    const current = initialLoadRef.current
    const sameContext = current?.client === input.client && current.contextKey === contextKey
    if (sameContext && current.connState === input.connState) {
      return
    }
    const preferRepositorySnapshot =
      input.connState === 'connected' && !(sameContext && current.usedRepositorySnapshot)
    initialLoadRef.current = {
      client: input.client,
      contextKey,
      connState: input.connState,
      usedRepositorySnapshot:
        preferRepositorySnapshot || (sameContext && current.usedRepositorySnapshot)
    }
    void input.loadReviewData(preferRepositorySnapshot)
  }, [input.client, input.connState, input.hostId, input.loadReviewData, input.worktreeId])
}
