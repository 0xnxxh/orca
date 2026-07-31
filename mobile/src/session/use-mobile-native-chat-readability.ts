import { useEffect, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { isFloatingWorkspaceWorktreeId } from './floating-workspace'
import { isMobileNativeChatTranscriptReadable } from './mobile-native-chat-eligibility'
import { getRepoIdFromMobileWorktreeId } from './mobile-session-route-helpers'

type WorkspaceSummary = { id: string; connectionId?: string | null }
type ReadabilityState = { client: RpcClient | null; worktreeId: string; readable: boolean }

export function useMobileNativeChatReadability(
  client: RpcClient | null,
  worktreeId: string
): boolean {
  const isFloatingWorkspace = isFloatingWorkspaceWorktreeId(worktreeId)
  const isFolderWorkspace = worktreeId.startsWith('folder:')
  const [state, setState] = useState<ReadabilityState>({
    client: null,
    worktreeId: '',
    readable: false
  })
  useEffect(() => {
    // Why: the floating workspace always runs on the paired host and has no repo connection to resolve.
    if (isFloatingWorkspace) {
      return
    }
    let active = true
    if (!client) {
      setState({ client, worktreeId, readable: false })
      return
    }
    void client
      .sendRequest(isFolderWorkspace ? 'folderWorkspace.list' : 'repo.list')
      .then((response) => {
        if (!active) {
          return
        }
        const workspaces = response.ok
          ? isFolderWorkspace
            ? ((response.result as { folderWorkspaces?: WorkspaceSummary[] }).folderWorkspaces ??
              [])
            : ((response.result as { repos?: WorkspaceSummary[] }).repos ?? [])
          : []
        const workspaceId = isFolderWorkspace
          ? worktreeId.slice('folder:'.length)
          : getRepoIdFromMobileWorktreeId(worktreeId)
        const workspace = workspaces.find((candidate) => candidate.id === workspaceId)
        setState({
          client,
          worktreeId,
          readable: workspace
            ? isMobileNativeChatTranscriptReadable(workspace.connectionId ?? null)
            : false
        })
      })
      .catch(() => {
        if (active) {
          setState({ client, worktreeId, readable: false })
        }
      })
    return () => {
      active = false
    }
  }, [client, isFloatingWorkspace, isFolderWorkspace, worktreeId])
  if (isFloatingWorkspace) {
    return true
  }
  // Why: route reuse renders before its new effect resolves; never expose the
  // previous repo's readability under a different client/worktree key.
  return state.client === client && state.worktreeId === worktreeId ? state.readable : false
}
