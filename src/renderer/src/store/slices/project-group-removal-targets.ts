import type { FolderWorkspace, ProjectGroup, Repo } from '../../../../shared/types'
import {
  getRepoExecutionHostId,
  normalizeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import {
  buildProjectGroupOwnerIndex,
  getProjectGroupIdentity,
  getProjectGroupOwnerHostId,
  getProjectGroupOwnerIdentity,
  getProjectGroupOwnerSubtreeIdentities,
  resolveProjectGroupOwner,
  type ProjectGroupOwnerIndex
} from '../../../../shared/project-groups'
import { getRepoHostIdentity } from './repo-host-identity'

export type ProjectGroupRemovalProjectTarget = {
  projectId: string
  ownerHostId: ExecutionHostId
  identity: string
}

export type ProjectGroupRemovalTargets = {
  groupExists: boolean
  ownerHostId: ExecutionHostId | null
  deletedGroupIds: Set<string>
  deletedGroupIdentities: Set<string>
  projectIds: string[]
  projectTargets: ProjectGroupRemovalProjectTarget[]
  folderWorkspaceIdentities: Set<string>
}

function getFolderWorkspacePreferredOwnerHostId(
  workspace: Pick<FolderWorkspace, 'connectionId' | 'executionHostId'>
): ExecutionHostId | undefined {
  return (
    normalizeExecutionHostId(workspace.executionHostId) ??
    (workspace.connectionId ? toSshExecutionHostId(workspace.connectionId) : undefined)
  )
}

function resolveFolderWorkspaceProjectGroup(
  index: ProjectGroupOwnerIndex,
  workspace: Pick<FolderWorkspace, 'connectionId' | 'executionHostId' | 'projectGroupId'>
): ProjectGroup | null {
  return resolveProjectGroupOwner(
    index,
    workspace.projectGroupId,
    getFolderWorkspacePreferredOwnerHostId(workspace)
  )
}

export function getProjectGroupRemovalFolderWorkspaceIdentity(
  index: ProjectGroupOwnerIndex,
  workspace: Pick<FolderWorkspace, 'id' | 'projectGroupId' | 'connectionId' | 'executionHostId'>
): string | null {
  const group = resolveFolderWorkspaceProjectGroup(index, workspace)
  return group ? JSON.stringify([getProjectGroupOwnerHostId(group), workspace.id]) : null
}

function emptyRemovalTargets(): ProjectGroupRemovalTargets {
  return {
    groupExists: false,
    ownerHostId: null,
    deletedGroupIds: new Set(),
    deletedGroupIdentities: new Set(),
    projectIds: [],
    projectTargets: [],
    folderWorkspaceIdentities: new Set()
  }
}

export function selectProjectGroupRemovalTargets(
  projectGroups: readonly ProjectGroup[],
  repos: readonly Repo[],
  groupId: string,
  ownerHostId?: ExecutionHostId,
  folderWorkspaces: readonly FolderWorkspace[] = []
): ProjectGroupRemovalTargets {
  const index = buildProjectGroupOwnerIndex(projectGroups)
  const rootGroup = resolveProjectGroupOwner(index, groupId, ownerHostId)
  if (!rootGroup) {
    return emptyRemovalTargets()
  }

  const selectedOwnerHostId = getProjectGroupOwnerHostId(rootGroup)
  const deletedGroupIdentities = getProjectGroupOwnerSubtreeIdentities(projectGroups, rootGroup)
  const deletedGroupIds = new Set(
    projectGroups.flatMap((group) =>
      deletedGroupIdentities.has(
        getProjectGroupIdentity(group.id, getProjectGroupOwnerHostId(group))
      )
        ? [group.id]
        : []
    )
  )
  const projectTargets: ProjectGroupRemovalProjectTarget[] = []
  const seenProjectIdentities = new Set<string>()
  for (const repo of repos) {
    if (!repo.projectGroupId) {
      continue
    }
    const repoOwnerHostId = getRepoExecutionHostId(repo)
    const groupIdentity = getProjectGroupIdentity(repo.projectGroupId, repoOwnerHostId)
    const identity = getRepoHostIdentity(repo)
    if (deletedGroupIdentities.has(groupIdentity) && !seenProjectIdentities.has(identity)) {
      seenProjectIdentities.add(identity)
      projectTargets.push({ projectId: repo.id, ownerHostId: repoOwnerHostId, identity })
    }
  }
  const folderWorkspaceIdentities = new Set<string>()
  for (const workspace of folderWorkspaces) {
    const group = resolveFolderWorkspaceProjectGroup(index, workspace)
    if (!group || !deletedGroupIdentities.has(getProjectGroupOwnerIdentity(group))) {
      continue
    }
    folderWorkspaceIdentities.add(JSON.stringify([getProjectGroupOwnerHostId(group), workspace.id]))
  }

  return {
    groupExists: true,
    ownerHostId: selectedOwnerHostId,
    deletedGroupIds,
    deletedGroupIdentities,
    projectIds: projectTargets.map((target) => target.projectId),
    projectTargets,
    folderWorkspaceIdentities
  }
}
