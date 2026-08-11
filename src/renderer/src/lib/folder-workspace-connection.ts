import type { FolderWorkspace, ProjectGroup, Repo } from '../../../shared/types'
import { isPathInsideOrEqual } from '../../../shared/cross-platform-path'
import {
  buildProjectGroupOwnerIndex,
  getProjectGroupIdentity,
  getProjectGroupOwnerHostId,
  getProjectGroupOwnerSubtreeIdentities
} from '../../../shared/project-groups'
import {
  resolveFolderWorkspaceCatalogOwnerHostId,
  resolveFolderWorkspaceProjectGroupWithLegacySsh
} from '../../../shared/folder-workspaces'
import {
  getRepoExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'

export type FolderWorkspaceConnectionState = {
  folderWorkspaces: FolderWorkspace[]
  projectGroups: ProjectGroup[]
  repos: Repo[]
  activeWorktreeId?: string | null
  activeWorkspaceExecutionHostId?: ExecutionHostId | null
}

function getFolderScopeCandidateRepos(args: {
  folderPath: string
  projectGroup: ProjectGroup
  ownerHostId: ExecutionHostId
  connectionId?: string | null
  projectGroups: readonly ProjectGroup[]
  repos: readonly Repo[]
}): Repo[] {
  const groupIdentities = getProjectGroupOwnerSubtreeIdentities(
    args.projectGroups,
    args.projectGroup
  )
  const groupRepos = args.repos.filter(
    (repo) =>
      typeof repo.projectGroupId === 'string' &&
      groupIdentities.has(
        getProjectGroupIdentity(repo.projectGroupId, getRepoExecutionHostId(repo))
      )
  )
  const pathRepos = args.repos.filter(
    (repo) =>
      getRepoExecutionHostId(repo) === args.ownerHostId &&
      !(
        typeof repo.projectGroupId === 'string' &&
        groupIdentities.has(
          getProjectGroupIdentity(repo.projectGroupId, getRepoExecutionHostId(repo))
        )
      ) &&
      isPathInsideOrEqual(args.folderPath, repo.path)
  )
  if (args.connectionId) {
    return [
      ...groupRepos,
      ...pathRepos.filter((repo) => (repo.connectionId ?? null) === args.connectionId)
    ]
  }
  if (groupRepos.length === 0) {
    return pathRepos
  }
  const groupConnectionIds = new Set(groupRepos.map((repo) => repo.connectionId ?? null))
  return [
    ...groupRepos,
    ...pathRepos.filter((repo) => groupConnectionIds.has(repo.connectionId ?? null))
  ]
}

function findFolderWorkspaceScope(
  state: FolderWorkspaceConnectionState,
  folderWorkspaceId: string,
  ownerHostId?: ExecutionHostId
): { workspace: FolderWorkspace; projectGroup: ProjectGroup; ownerHostId: ExecutionHostId } | null {
  const activeScope = parseWorkspaceKey(state.activeWorktreeId ?? '')
  const activeOwnerHostId =
    activeScope?.type === 'folder' && activeScope.folderWorkspaceId === folderWorkspaceId
      ? (activeScope.ownerHostId ?? state.activeWorkspaceExecutionHostId)
      : undefined
  const requestedOwnerHostId = ownerHostId ?? activeOwnerHostId ?? undefined
  const candidates = state.folderWorkspaces.filter((entry) => entry.id === folderWorkspaceId)
  const workspace = requestedOwnerHostId
    ? candidates.find(
        (entry) =>
          resolveFolderWorkspaceCatalogOwnerHostId(entry, state.projectGroups) ===
          requestedOwnerHostId
      )
    : candidates.length === 1
      ? candidates[0]
      : undefined
  if (!workspace) {
    return null
  }
  const projectGroup = resolveFolderWorkspaceProjectGroupWithLegacySsh(
    buildProjectGroupOwnerIndex(state.projectGroups),
    workspace
  )
  if (!projectGroup) {
    return null
  }
  return {
    workspace,
    projectGroup,
    ownerHostId: getProjectGroupOwnerHostId(projectGroup)
  }
}

export function getFolderWorkspaceCandidateRepos(
  state: FolderWorkspaceConnectionState,
  folderWorkspaceId: string,
  ownerHostId?: ExecutionHostId
): Repo[] {
  const scope = findFolderWorkspaceScope(state, folderWorkspaceId, ownerHostId)
  if (!scope) {
    return []
  }
  return getFolderScopeCandidateRepos({
    folderPath: scope.workspace.folderPath,
    projectGroup: scope.projectGroup,
    ownerHostId: scope.ownerHostId,
    connectionId: scope.workspace.connectionId ?? scope.projectGroup.connectionId ?? null,
    projectGroups: state.projectGroups,
    repos: state.repos
  })
}

export function getFolderWorkspaceConnectionId(
  state: FolderWorkspaceConnectionState,
  folderWorkspaceId: string,
  ownerHostId?: ExecutionHostId
): string | null | undefined {
  const scope = findFolderWorkspaceScope(state, folderWorkspaceId, ownerHostId)
  if (!scope) {
    return undefined
  }
  const { workspace, projectGroup } = scope
  const explicitHost = parseExecutionHostId(workspace.executionHostId)
  if (explicitHost) {
    return explicitHost.kind === 'ssh' ? explicitHost.targetId : null
  }
  const scopeConnectionId = workspace.connectionId ?? projectGroup.connectionId ?? null
  const candidateRepos = getFolderWorkspaceCandidateRepos(
    state,
    folderWorkspaceId,
    scope.ownerHostId
  )
  let hasLocalRepo = false
  const connectionIds = new Set<string>()
  for (const repo of candidateRepos) {
    if (repo.connectionId) {
      connectionIds.add(repo.connectionId)
    } else {
      hasLocalRepo = true
    }
  }
  if (scopeConnectionId) {
    const hasDifferentSshConnection = [...connectionIds].some(
      (connectionId) => connectionId !== scopeConnectionId
    )
    if (hasLocalRepo || hasDifferentSshConnection) {
      return undefined
    }
    return scopeConnectionId
  }
  if (candidateRepos.length === 0) {
    return null
  }
  if (hasLocalRepo && connectionIds.size > 0) {
    return undefined
  }
  if (connectionIds.size === 0) {
    return null
  }
  if (connectionIds.size === 1) {
    return [...connectionIds][0]
  }
  return undefined
}
