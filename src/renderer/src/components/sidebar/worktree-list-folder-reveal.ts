import type { FolderWorkspace, ProjectGroup, Worktree } from '../../../../shared/types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import { resolveFolderWorkspaceCatalogOwnerHostId } from '../../../../shared/folder-workspaces'
import { folderWorkspaceKey, parseWorkspaceKey } from '../../../../shared/workspace-scope'
import {
  buildProjectGroupSidebarIndex,
  findProjectGroupForSidebarOwner,
  findProjectGroupParentForSidebar,
  getProjectGroupHeaderKey
} from './worktree-list-groups'

function findFolderWorkspaceByKey(
  worktreeId: string,
  folderWorkspaces: readonly FolderWorkspace[],
  projectGroups: readonly ProjectGroup[] = [],
  ownerHostId?: ExecutionHostId
): FolderWorkspace | null {
  const scope = parseWorkspaceKey(worktreeId)
  if (scope?.type !== 'folder') {
    return null
  }
  const candidates = folderWorkspaces.filter(
    (workspace) => workspace.id === scope.folderWorkspaceId
  )
  if (ownerHostId) {
    return (
      candidates.find(
        (workspace) =>
          resolveFolderWorkspaceCatalogOwnerHostId(workspace, projectGroups) === ownerHostId
      ) ?? null
    )
  }
  return candidates.length === 1 ? candidates[0] : null
}

export function getFolderWorkspaceSidebarRowKey(folderWorkspaceId: string, rowKey: string): string {
  return rowKey === `folder-workspace:${folderWorkspaceId}`
    ? folderWorkspaceKey(folderWorkspaceId)
    : rowKey
}

export function shouldClearActiveFolderWorkspaceAfterDelete(args: {
  activeWorktreeId: string | null
  activeOwnerHostId: ExecutionHostId | null
  deletedFolderWorkspaceId: string
  deletedOwnerHostId?: ExecutionHostId
  sameIdWorkspaceStillExists?: boolean
}): boolean {
  if (args.activeWorktreeId !== folderWorkspaceKey(args.deletedFolderWorkspaceId)) {
    return false
  }
  if (!args.deletedOwnerHostId) {
    return true
  }
  return args.activeOwnerHostId
    ? args.activeOwnerHostId === args.deletedOwnerHostId
    : !args.sameIdWorkspaceStillExists
}

export function getKnownSidebarWorktreeById(
  worktreeId: string,
  worktreeMap: ReadonlyMap<string, Worktree>,
  folderWorkspaces: readonly FolderWorkspace[],
  projectGroups: readonly ProjectGroup[] = [],
  ownerHostId?: ExecutionHostId
): Worktree | null {
  const worktree = worktreeMap.get(worktreeId)
  if (worktree) {
    return worktree
  }
  const folderWorkspace = findFolderWorkspaceByKey(
    worktreeId,
    folderWorkspaces,
    projectGroups,
    ownerHostId
  )
  return folderWorkspace ? folderWorkspaceToWorktree(folderWorkspace) : null
}

export function sidebarWorkspaceStillExists(
  worktreeId: string,
  worktrees: readonly Worktree[],
  folderWorkspaces: readonly FolderWorkspace[],
  projectGroups: readonly ProjectGroup[] = [],
  ownerHostId?: ExecutionHostId
): boolean {
  if (worktrees.some((worktree) => worktree.id === worktreeId)) {
    return true
  }
  return findFolderWorkspaceByKey(worktreeId, folderWorkspaces, projectGroups, ownerHostId) !== null
}

export function getFolderWorkspaceRevealGroupKeys(
  worktreeId: string,
  folderWorkspaces: readonly FolderWorkspace[],
  projectGroups: readonly ProjectGroup[],
  ownerHostId?: ExecutionHostId
): string[] {
  const folderWorkspace = findFolderWorkspaceByKey(
    worktreeId,
    folderWorkspaces,
    projectGroups,
    ownerHostId
  )
  if (!folderWorkspace) {
    return []
  }

  const resolvedOwnerHostId =
    ownerHostId ?? resolveFolderWorkspaceCatalogOwnerHostId(folderWorkspace, projectGroups)
  if (!resolvedOwnerHostId) {
    return []
  }
  const projectGroupIndex = buildProjectGroupSidebarIndex(projectGroups)
  let group = findProjectGroupForSidebarOwner(
    projectGroupIndex,
    folderWorkspace.projectGroupId,
    resolvedOwnerHostId
  )
  const keys: string[] = []
  const seen = new Set<string>()
  while (group) {
    const identity = JSON.stringify([resolvedOwnerHostId, group.id])
    if (seen.has(identity)) {
      break
    }
    seen.add(identity)
    keys.unshift(
      getProjectGroupHeaderKey(
        group.id,
        projectGroupIndex.ambiguousIds.has(group.id) ? resolvedOwnerHostId : undefined
      )
    )
    group = findProjectGroupParentForSidebar(projectGroupIndex, group)
  }
  return keys
}
