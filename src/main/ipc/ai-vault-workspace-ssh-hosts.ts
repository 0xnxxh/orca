import { isRuntimeOwnedSshTargetId } from '../../shared/execution-host'
import type { SshConnectionStatus, SshTarget } from '../../shared/ssh-types'
import type { Repo } from '../../shared/types'
import type { ExpectedSshAiVaultHost } from '../ai-vault/unscanned-ssh-host-issues'

/**
 * The SSH hosts an all-hosts session list is expected to cover: those that own
 * at least one Orca repo or folder workspace and still exist as a target.
 *
 * Why gate on owning a workspace rather than taking every registered target:
 * `ssh:importConfig` can register dozens of ~/.ssh/config aliases the user never
 * opens, and each would otherwise turn into a permanent "not connected" row.
 */
export function listWorkspaceSshAiVaultHosts(deps: {
  getRepos: () => readonly Pick<Repo, 'connectionId'>[]
  listTargets: () => readonly Pick<SshTarget, 'id' | 'label' | 'owner'>[]
  getConnectionStatus: (targetId: string) => SshConnectionStatus | undefined
}): ExpectedSshAiVaultHost[] {
  const workspaceTargetIds = new Set<string>()
  for (const repo of deps.getRepos()) {
    if (repo.connectionId) {
      workspaceTargetIds.add(repo.connectionId)
    }
  }
  // Iterating targets (not repos) dedupes hosts with several workspaces, keeps a
  // stable order, and drops repos still pointing at a removed target.
  return deps
    .listTargets()
    .filter(
      (target) =>
        workspaceTargetIds.has(target.id) &&
        target.owner === undefined &&
        !isRuntimeOwnedSshTargetId(target.id)
    )
    .map((target) => ({
      targetId: target.id,
      label: target.label.trim() || target.id,
      connectionStatus: deps.getConnectionStatus(target.id)
    }))
}
