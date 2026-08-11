import type { FolderWorkspace, ProjectGroup, Worktree } from '../../../../shared/types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import { resolveFolderWorkspaceCatalogOwnerHostId } from '../../../../shared/folder-workspaces'
import { folderWorkspaceKey, parseWorkspaceKey } from '../../../../shared/workspace-scope'
import {
  buildProjectGroupSidebarIndex,
  findProjectGroupForFolderWorkspace,
  findProjectGroupParentForSidebar,
  getProjectGroupHeaderKey,
  getProjectGroupOwnerHostId,
  getProjectGroupSidebarIdentity
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
  const effectiveOwnerHostId = ownerHostId ?? scope.ownerHostId
  if (effectiveOwnerHostId) {
    return (
      candidates.find(
        (workspace) =>
          resolveFolderWorkspaceCatalogOwnerHostId(workspace, projectGroups) ===
          effectiveOwnerHostId
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
  const activeScope = parseWorkspaceKey(args.activeWorktreeId ?? '')
  if (
    activeScope?.type !== 'folder' ||
    activeScope.folderWorkspaceId !== args.deletedFolderWorkspaceId
  ) {
    return false
  }
  if (!args.deletedOwnerHostId) {
    return true
  }
  const activeOwnerHostId = args.activeOwnerHostId ?? activeScope.ownerHostId
  return activeOwnerHostId
    ? activeOwnerHostId === args.deletedOwnerHostId
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

  const projectGroupIndex = buildProjectGroupSidebarIndex(projectGroups)
  let group = findProjectGroupForFolderWorkspace(projectGroupIndex, folderWorkspace)
  const keys: string[] = []
  const seen = new Set<string>()
  while (group) {
    const identity = getProjectGroupSidebarIdentity(group)
    if (seen.has(identity)) {
      break
    }
    seen.add(identity)
    const groupOwnerHostId = getProjectGroupOwnerHostId(group)
    keys.unshift(
      getProjectGroupHeaderKey(
        group.id,
        projectGroupIndex.ambiguousIds.has(group.id) ? groupOwnerHostId : undefined
      )
    )
    group = findProjectGroupParentForSidebar(projectGroupIndex, group)
  }
  return keys
}
