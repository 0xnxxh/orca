import { normalizeExecutionHostId } from './execution-host'
import {
  resolveFolderWorkspaceProjectGroup,
  resolveProjectGroupOwner,
  type ProjectGroupOwnerIndex
} from './project-groups'
import type { FolderWorkspace, ProjectGroup } from './types'

export function resolveFolderWorkspaceProjectGroupWithLegacySsh(
  index: ProjectGroupOwnerIndex,
  workspace: Pick<FolderWorkspace, 'connectionId' | 'executionHostId' | 'projectGroupId'>
): ProjectGroup | null {
  const strict = resolveFolderWorkspaceProjectGroup(index, workspace)
  if (strict || !workspace.connectionId) {
    return strict
  }
  const group = resolveProjectGroupOwner(index, workspace.projectGroupId)
  return group &&
    group.connectionId === undefined &&
    !normalizeExecutionHostId(group.executionHostId)
    ? group
    : null
}
