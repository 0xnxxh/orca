import {
  ALL_EXECUTION_HOSTS_SCOPE,
  getRepoExecutionHostId,
  normalizeExecutionHostId,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId,
  type ExecutionHostScope
} from '../../../../shared/execution-host'
import type { FolderWorkspacePathStatusRequest } from '../../../../shared/folder-workspace-path-status'
import type { FolderWorkspace, ProjectGroup, Repo } from '../../../../shared/types'
import {
  buildProjectGroupSidebarIndex,
  findProjectGroupForFolderWorkspace,
  findProjectGroupParentForSidebar,
  getFolderWorkspaceExecutionHostIdForRows,
  getProjectGroupExecutionHostIdForRows,
  getProjectGroupSidebarIdentity
} from './worktree-list-groups'

export { getFolderWorkspaceExecutionHostIdForRows, getProjectGroupExecutionHostIdForRows }

export function buildFolderPathStatusRepoMembershipKey(
  repos: readonly Pick<
    Repo,
    'id' | 'path' | 'projectGroupId' | 'connectionId' | 'executionHostId'
  >[]
): string {
  return JSON.stringify(
    repos.map((repo) => [
      getRepoExecutionHostId(repo),
      repo.id,
      repo.path,
      repo.projectGroupId ?? '',
      repo.connectionId ?? ''
    ])
  )
}

/** null means "no host filter" — every host is visible. */
export function getVisibleSidebarHostIdSet(
  visibleWorkspaceHostIds: readonly ExecutionHostId[] | null | undefined,
  workspaceHostScope: ExecutionHostScope
): Set<ExecutionHostId> | null {
  const visibleHostIds =
    visibleWorkspaceHostIds ??
    (workspaceHostScope === ALL_EXECUTION_HOSTS_SCOPE ? null : [workspaceHostScope])
  return visibleHostIds ? new Set<ExecutionHostId>(visibleHostIds) : null
}

// Why shared: the sidebar render path and the Cmd+1–9 order must apply the same
// host filtering, or the numbering drifts from the cards whenever a filter is on.
export function filterProjectGroupsForVisibleHosts(
  projectGroups: readonly ProjectGroup[],
  visibleHostIdSet: ReadonlySet<ExecutionHostId> | null,
  defaultHostId: ExecutionHostId,
  folderWorkspaces?: readonly FolderWorkspace[]
): readonly ProjectGroup[] {
  if (!visibleHostIdSet || !folderWorkspaces) {
    return projectGroups
  }
  const retainedFolderGroupIdentities = new Set<string>()
  const projectGroupIndex = buildProjectGroupSidebarIndex(projectGroups)
  for (const folderWorkspace of folderWorkspaces) {
    let group = findProjectGroupForFolderWorkspace(projectGroupIndex, folderWorkspace)
    if (
      !group ||
      !visibleHostIdSet.has(
        getFolderWorkspaceExecutionHostIdForRows({
          folderWorkspace,
          projectGroup: group,
          defaultHostId
        })
      )
    ) {
      continue
    }
    while (group) {
      const identity = getProjectGroupSidebarIdentity(group)
      if (retainedFolderGroupIdentities.has(identity)) {
        break
      }
      retainedFolderGroupIdentities.add(identity)
      group = findProjectGroupParentForSidebar(projectGroupIndex, group)
    }
  }
  return projectGroups.filter(
    (group) =>
      visibleHostIdSet.has(getProjectGroupExecutionHostIdForRows(group, defaultHostId)) ||
      retainedFolderGroupIdentities.has(getProjectGroupSidebarIdentity(group))
  )
}

export function filterFolderWorkspacesForVisibleHosts(
  folderWorkspaces: readonly FolderWorkspace[],
  projectGroups: readonly ProjectGroup[],
  visibleHostIdSet: ReadonlySet<ExecutionHostId> | null,
  defaultHostId: ExecutionHostId
): readonly FolderWorkspace[] {
  if (!visibleHostIdSet) {
    return folderWorkspaces
  }
  const projectGroupIndex = buildProjectGroupSidebarIndex(projectGroups)
  return folderWorkspaces.filter((folderWorkspace) =>
    visibleHostIdSet.has(
      getFolderWorkspaceExecutionHostIdForRows({
        folderWorkspace,
        projectGroup: findProjectGroupForFolderWorkspace(projectGroupIndex, folderWorkspace),
        defaultHostId
      })
    )
  )
}

export function getRuntimeEnvironmentIdForFolderPathStatusHost(
  hostId: ExecutionHostId
): string | null {
  const parsed = parseExecutionHostId(hostId)
  return parsed?.kind === 'runtime' ? parsed.environmentId : null
}

function getProjectGroupExecutionHostIdForFolderPathStatus(
  group: Pick<ProjectGroup, 'connectionId' | 'executionHostId'>
): ExecutionHostId {
  const executionHostId = normalizeExecutionHostId(group.executionHostId)
  if (executionHostId) {
    return executionHostId
  }
  return group.connectionId ? toSshExecutionHostId(group.connectionId) : 'local'
}

export function getFolderPathStatusRouteOptionsForRows({
  request,
  projectGroupsById,
  folderWorkspacesById
}: {
  request: FolderWorkspacePathStatusRequest
  projectGroupsById: ReadonlyMap<string, ProjectGroup>
  folderWorkspacesById: ReadonlyMap<string, FolderWorkspace>
}): { runtimeEnvironmentId: string | null } | undefined {
  if (request.scope !== 'path' && request.ownerHostId) {
    return {
      runtimeEnvironmentId: getRuntimeEnvironmentIdForFolderPathStatusHost(request.ownerHostId)
    }
  }
  const folderWorkspace =
    request.scope === 'folder-workspace'
      ? folderWorkspacesById.get(request.folderWorkspaceId)
      : undefined
  const group =
    request.scope === 'project-group'
      ? projectGroupsById.get(request.projectGroupId)
      : projectGroupsById.get(folderWorkspace?.projectGroupId ?? '')
  if (!group) {
    return undefined
  }
  const hostId =
    request.scope === 'project-group'
      ? getProjectGroupExecutionHostIdForFolderPathStatus(group)
      : getFolderWorkspaceExecutionHostIdForRows({
          folderWorkspace: folderWorkspace ?? { connectionId: null, executionHostId: null },
          projectGroup: group,
          defaultHostId: getProjectGroupExecutionHostIdForFolderPathStatus(group)
        })
  const runtimeEnvironmentId = getRuntimeEnvironmentIdForFolderPathStatusHost(hostId)
  return { runtimeEnvironmentId }
}
