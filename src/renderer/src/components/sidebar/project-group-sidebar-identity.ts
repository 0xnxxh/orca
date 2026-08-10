import type { FolderWorkspace, ProjectGroup, Repo } from '../../../../shared/types'
import {
  getRepoExecutionHostId,
  normalizeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import {
  getProjectGroupOwnerHostId as getSharedProjectGroupOwnerHostId,
  getProjectGroupOwnerIdentity
} from '../../../../shared/project-groups'

export type ProjectGroupSidebarIdentity = string

export function getProjectGroupOwnerHostId(
  group: Pick<ProjectGroup, 'connectionId' | 'executionHostId'>
): ExecutionHostId {
  return getSharedProjectGroupOwnerHostId(group)
}

export function getProjectGroupSidebarIdentity(
  group: Pick<ProjectGroup, 'id' | 'connectionId' | 'executionHostId'>
): ProjectGroupSidebarIdentity {
  return getProjectGroupOwnerIdentity(group)
}

export function hasSingleProjectGroupMutationOwner(
  groups: readonly ProjectGroup[],
  routedHostId: ExecutionHostId
): boolean {
  if (groups.length === 0) {
    return false
  }
  return groups.every((group) => getProjectGroupOwnerHostId(group) === routedHostId)
}

export function parseProjectGroupSidebarHeaderKey(
  key: string
): { groupId: string; ownerHostId?: ExecutionHostId } | null {
  const prefix = 'project-group:'
  if (!key.startsWith(prefix)) {
    return null
  }
  const value = key.slice(prefix.length)
  const separator = value.indexOf(':')
  if (separator === -1) {
    return { groupId: value }
  }
  let ownerHostId: ExecutionHostId | null
  let groupId: string
  try {
    ownerHostId = normalizeExecutionHostId(decodeURIComponent(value.slice(0, separator)))
    groupId = decodeURIComponent(value.slice(separator + 1))
  } catch {
    return null
  }
  if (!ownerHostId) {
    return null
  }
  return {
    ownerHostId,
    groupId
  }
}

export type ProjectGroupSidebarIndex = {
  byIdentity: ReadonlyMap<ProjectGroupSidebarIdentity, ProjectGroup>
  byUnambiguousId: ReadonlyMap<string, ProjectGroup>
  ambiguousIds: ReadonlySet<string>
}

export function buildProjectGroupSidebarIndex(
  projectGroups: readonly ProjectGroup[]
): ProjectGroupSidebarIndex {
  const byIdentity = new Map<ProjectGroupSidebarIdentity, ProjectGroup>()
  const byUnambiguousId = new Map<string, ProjectGroup>()
  const ambiguousIds = new Set<string>()
  for (const group of projectGroups) {
    byIdentity.set(getProjectGroupSidebarIdentity(group), group)
    if (ambiguousIds.has(group.id)) {
      continue
    }
    const existing = byUnambiguousId.get(group.id)
    if (
      existing &&
      getProjectGroupSidebarIdentity(existing) !== getProjectGroupSidebarIdentity(group)
    ) {
      byUnambiguousId.delete(group.id)
      ambiguousIds.add(group.id)
    } else {
      byUnambiguousId.set(group.id, group)
    }
  }
  return { byIdentity, byUnambiguousId, ambiguousIds }
}

export function findProjectGroupForSidebarOwner(
  index: ProjectGroupSidebarIndex,
  groupId: string | null | undefined,
  ownerHostId?: ExecutionHostId | null
): ProjectGroup | undefined {
  if (!groupId) {
    return undefined
  }
  if (ownerHostId) {
    return index.byIdentity.get(JSON.stringify([ownerHostId, groupId]))
  }
  return index.byUnambiguousId.get(groupId)
}

export function findProjectGroupForRepo(
  index: ProjectGroupSidebarIndex,
  repo: Pick<Repo, 'connectionId' | 'executionHostId' | 'projectGroupId'> | undefined,
  defaultHostId: ExecutionHostId
): ProjectGroup | undefined {
  if (!repo?.projectGroupId) {
    return undefined
  }
  const ownerHostId =
    repo.connectionId || repo.executionHostId ? getRepoExecutionHostId(repo) : defaultHostId
  return findProjectGroupForSidebarOwner(index, repo.projectGroupId, ownerHostId)
}

export function findProjectGroupForFolderWorkspace(
  index: ProjectGroupSidebarIndex,
  workspace: Pick<FolderWorkspace, 'connectionId' | 'executionHostId' | 'projectGroupId'>
): ProjectGroup | undefined {
  const explicitHostId = normalizeExecutionHostId(workspace.executionHostId)
  // Why: connectionId null is an explicit local stamp; leave undefined only when owner is unknown.
  const ownerHostId =
    explicitHostId ??
    (workspace.connectionId
      ? toSshExecutionHostId(workspace.connectionId)
      : workspace.connectionId === null
        ? ('local' as ExecutionHostId)
        : undefined)
  return findProjectGroupForSidebarOwner(index, workspace.projectGroupId, ownerHostId)
}

export function findProjectGroupParentForSidebar(
  index: ProjectGroupSidebarIndex,
  group: ProjectGroup
): ProjectGroup | undefined {
  return findProjectGroupForSidebarOwner(
    index,
    group.parentGroupId,
    getProjectGroupOwnerHostId(group)
  )
}
