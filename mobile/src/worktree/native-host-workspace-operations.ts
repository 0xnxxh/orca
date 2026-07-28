import type { RuntimeClientEventStreamMessage } from '../../../src/shared/runtime-client-events'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import type { HostWorkspaceChange, HostWorkspaceOperations } from './host-workspace-operations'
import type { RepoSummary } from './host-worktree-rpc-types'
import type { Worktree } from './workspace-list-types'
import type { WorkspaceViewSettings } from './workspace-view-settings'

export function nativeHostWorkspaceOperations(client: RpcClient): HostWorkspaceOperations {
  return {
    async getViewSettings() {
      const response = await client.sendRequest('ui.get')
      requireSuccess(response)
      return ((response as RpcSuccess).result as { ui?: WorkspaceViewSettings }).ui ?? null
    },
    async setViewSettings(settings) {
      requireSuccess(await client.sendRequest('ui.set', settings))
    },
    async listRepos() {
      const response = await client.sendRequest('repo.list')
      requireSuccess(response)
      return ((response as RpcSuccess).result as { repos: RepoSummary[] }).repos
    },
    async listWorkspaces(limit) {
      const response = await client.sendRequest('worktree.ps', { limit })
      requireSuccess(response)
      return ((response as RpcSuccess).result as { worktrees: Worktree[] }).worktrees
    },
    async setPinned(workspaceId, pinned) {
      requireSuccess(
        await client.sendRequest('worktree.set', {
          worktree: `id:${workspaceId}`,
          isPinned: pinned
        })
      )
    },
    async removeWorkspace(workspaceId) {
      const response = await client.sendRequest('worktree.rm', {
        worktree: `id:${workspaceId}`,
        force: true
      })
      return response.ok
    },
    async activateWorkspace(workspaceId) {
      requireSuccess(
        await client.sendRequest('worktree.activate', {
          worktree: `id:${workspaceId}`,
          notifyClients: false,
          navigation: 'caller'
        })
      )
    },
    async sleepWorkspace(workspaceId) {
      requireSuccess(await client.sendRequest('worktree.sleep', { worktree: `id:${workspaceId}` }))
    },
    notifyForeground() {
      client.notifyForeground()
    },
    subscribeChanges(listener) {
      return client.subscribe('runtime.clientEvents.subscribe', null, (payload) => {
        const event = hostWorkspaceChange(payload)
        if (event) {
          listener(event)
        }
      })
    }
  }
}

function hostWorkspaceChange(payload: unknown): HostWorkspaceChange | null {
  if (!payload || typeof payload !== 'object' || !('type' in payload)) {
    return null
  }
  const event = payload as RuntimeClientEventStreamMessage | { type: 'error' }
  return event.type === 'ready' ||
    event.type === 'end' ||
    event.type === 'reposChanged' ||
    event.type === 'worktreesChanged' ||
    event.type === 'error'
    ? event
    : null
}

function requireSuccess(response: { ok: boolean }): void {
  if (!response.ok) {
    throw new Error('host_workspace_operation_failed')
  }
}
