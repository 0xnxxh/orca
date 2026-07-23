import { useCallback } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'
import { getRepoIdFromMobileWorktreeId } from './mobile-session-route-helpers'

type RuntimeRepoSummary = {
  id: string
  connectionId?: string | null
}

export function useMobileWorktreeConnectionId(args: {
  client: RpcClient | null
  worktreeId: string
  isFloatingWorkspace: boolean
}): () => Promise<string | null> {
  const { client, worktreeId, isFloatingWorkspace } = args
  return useCallback(async (): Promise<string | null> => {
    // Why: the floating workspace always runs on the paired host itself, never an SSH repo target.
    if (!client || isFloatingWorkspace) {
      return null
    }
    const repoId = getRepoIdFromMobileWorktreeId(worktreeId)
    const response = await client.sendRequest('repo.list')
    if (!response.ok) {
      throw new Error((response as RpcFailure).error.message)
    }
    const repos = ((response as RpcSuccess).result as { repos?: RuntimeRepoSummary[] }).repos ?? []
    return repos.find((repo) => repo.id === repoId)?.connectionId?.trim() || null
  }, [client, isFloatingWorkspace, worktreeId])
}
