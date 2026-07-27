import type { useAppStore } from '@/store'
import { getAgentLaunchPlatformForRepo } from '@/lib/agent-launch-platform'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import { getFolderWorkspaceConnectionId } from '@/lib/folder-workspace-connection'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import { isWindowsAbsolutePathLike } from '../../../shared/cross-platform-path'
import { repoIsRemote } from '../../../shared/agent-launch-remote'

type LaunchStore = ReturnType<typeof useAppStore.getState>
type LaunchRepo = LaunchStore['repos'][number]

export type AgentBackgroundLaunchHost = {
  /** SSH connection to spawn on, or null for a local launch. */
  connectionId: string | null
  /** Platform whose shell quoting and CLI naming the startup plan must target. */
  platform: NodeJS.Platform
  isRemote: boolean
  /**
   * Connection the agent-status consumer should accept writes from. `undefined`
   * means "unknown ownership, accept anything" — the pre-existing behavior for
   * workspaces with no resolvable owner.
   */
  expectedConnectionId: string | null | undefined
}

/**
 * SSH connection owning a folder-workspace selector, or null otherwise. Returns
 * null when ownership is ambiguous (mixed local/remote children) so an unclear
 * scope fails to a local launch rather than to the wrong host.
 */
function resolveFolderWorkspaceConnectionIdForLaunch(
  store: LaunchStore,
  worktreeId: string
): string | null {
  const parsed = parseWorkspaceKey(worktreeId)
  if (parsed?.type !== 'folder') {
    return null
  }
  return getFolderWorkspaceConnectionId(store, parsed.folderWorkspaceId) ?? null
}

/**
 * Resolve which host an automation's agent session runs on.
 *
 * Why this is not just `repo.connectionId`: a folder workspace has no repo row —
 * its synthetic repoId is `folder-workspace:<groupId>` — so repo-derived routing
 * finds nothing and falls back to a LOCAL spawn using a path that exists only on
 * the SSH host. Ownership has to come from the workspace scope, matching how
 * ordinary terminal creation resolves it (#2989).
 */
export function resolveAgentBackgroundLaunchHost(args: {
  store: LaunchStore
  worktreeId: string
  worktreePath: string | undefined
  repo: LaunchRepo | null | undefined
}): AgentBackgroundLaunchHost {
  const { store, worktreeId, worktreePath, repo } = args
  if (repo) {
    return {
      connectionId: repo.connectionId ?? null,
      platform: getAgentLaunchPlatformForRepo(
        repo,
        repo.connectionId ? undefined : getLocalProjectExecutionRuntimeContext(store, worktreeId)
      ),
      isRemote: repoIsRemote(repo),
      expectedConnectionId: repo.connectionId ?? null
    }
  }
  const folderWorkspaceConnectionId = resolveFolderWorkspaceConnectionIdForLaunch(store, worktreeId)
  return {
    connectionId: folderWorkspaceConnectionId,
    // A remote folder workspace runs under the host's own shell; only a
    // Windows-style path marks a win32 host (same rule as the repo path above).
    platform: folderWorkspaceConnectionId
      ? isWindowsAbsolutePathLike(worktreePath ?? '')
        ? 'win32'
        : 'linux'
      : CLIENT_PLATFORM,
    isRemote: Boolean(folderWorkspaceConnectionId),
    // A resolved folder-workspace connection is as authoritative as a repo's.
    expectedConnectionId: folderWorkspaceConnectionId ?? undefined
  }
}
