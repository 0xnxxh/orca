import {
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from './execution-host'
import {
  buildProjectGroupOwnerIndex,
  getFolderWorkspaceProjectGroupOwnerHostId,
  resolveFolderWorkspaceProjectGroup,
  resolveProjectGroupOwner
} from './project-groups'
import type { FolderWorkspace, ProjectGroup } from './types'
import { isTuiAgent } from './tui-agent-config'
import { normalizeStoredTaskSourceContext } from './task-source-context'
import { normalizeWorkspaceLinkedItem } from './workspace-linked-item'
import { isWorkspaceLinkedItemSourceContextMatch } from './workspace-linked-item-source-context'

export function getFolderWorkspaceCatalogOwnerHostId(
  workspace: Pick<FolderWorkspace, 'connectionId' | 'executionHostId' | 'projectGroupId'>,
  projectGroups: readonly ProjectGroup[] = []
): ExecutionHostId {
  const executionHostId = normalizeExecutionHostId(workspace.executionHostId)
  if (executionHostId) {
    return executionHostId
  }
  if (workspace.connectionId) {
    return toSshExecutionHostId(workspace.connectionId)
  }
  if (workspace.connectionId === null) {
    return LOCAL_EXECUTION_HOST_ID
  }
  if (projectGroups.length === 0) {
    return LOCAL_EXECUTION_HOST_ID
  }
  return getFolderWorkspaceProjectGroupOwnerHostId(
    workspace,
    buildProjectGroupOwnerIndex(projectGroups)
  )
}

export function getFolderWorkspaceOwnerIdentity(
  workspace: Pick<FolderWorkspace, 'id' | 'connectionId' | 'executionHostId' | 'projectGroupId'>,
  projectGroups: readonly ProjectGroup[] = []
): string {
  return getFolderWorkspaceIdentity(
    workspace.id,
    getFolderWorkspaceCatalogOwnerHostId(workspace, projectGroups)
  )
}

export function getFolderWorkspaceIdentity(
  folderWorkspaceId: string,
  ownerHostId: ExecutionHostId
): string {
  return JSON.stringify([ownerHostId, folderWorkspaceId])
}

export function getFolderWorkspaceRowKey(
  workspace: Pick<FolderWorkspace, 'id' | 'connectionId' | 'executionHostId' | 'projectGroupId'>,
  projectGroups: readonly ProjectGroup[] = []
): string {
  const ownerHostId = getFolderWorkspaceCatalogOwnerHostId(workspace, projectGroups)
  return `folder-workspace:${encodeURIComponent(ownerHostId)}:${encodeURIComponent(workspace.id)}`
}

export function normalizeFolderWorkspaceName(
  name: string | null | undefined,
  fallback = 'Untitled workspace'
): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed.length > 0 ? trimmed : fallback
}

export function normalizeFolderWorkspaces(
  value: unknown,
  projectGroups: readonly ProjectGroup[]
): FolderWorkspace[] {
  if (!Array.isArray(value)) {
    return []
  }
  const projectGroupIndex = buildProjectGroupOwnerIndex(projectGroups)

  const workspaces: FolderWorkspace[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      continue
    }
    const raw = candidate as Partial<FolderWorkspace>
    if (
      typeof raw.id !== 'string' ||
      raw.id.trim().length === 0 ||
      typeof raw.projectGroupId !== 'string'
    ) {
      continue
    }
    const executionHostId = normalizeExecutionHostId(raw.executionHostId)
    const group =
      resolveFolderWorkspaceProjectGroup(projectGroupIndex, {
        projectGroupId: raw.projectGroupId,
        connectionId: raw.connectionId,
        executionHostId
      }) ?? resolveProjectGroupOwner(projectGroupIndex, raw.projectGroupId)
    if (!group?.parentPath) {
      continue
    }
    const folderPath =
      typeof raw.folderPath === 'string' && raw.folderPath.trim().length > 0
        ? raw.folderPath
        : group?.parentPath
    if (!folderPath) {
      continue
    }
    const connectionId =
      typeof raw.connectionId === 'string'
        ? raw.connectionId
        : raw.connectionId === null
          ? null
          : (group?.connectionId ?? null)
    // Why: multi-host catalogs keep same-id folder rows; identity is owner+id, not bare id.
    const identity = getFolderWorkspaceOwnerIdentity(
      {
        id: raw.id,
        projectGroupId: raw.projectGroupId,
        connectionId,
        ...(executionHostId ? { executionHostId } : {})
      },
      projectGroups
    )
    if (seen.has(identity)) {
      continue
    }
    const now = Date.now()
    const linkedTask = normalizeWorkspaceLinkedItem(raw.linkedTask)
    const linkedTaskSourceContext = normalizeStoredTaskSourceContext(raw.linkedTaskSourceContext)
    seen.add(identity)
    workspaces.push({
      id: raw.id,
      projectGroupId: raw.projectGroupId,
      name: normalizeFolderWorkspaceName(raw.name),
      folderPath,
      connectionId,
      ...(executionHostId ? { executionHostId } : {}),
      linkedTask,
      linkedTaskSourceContext: isWorkspaceLinkedItemSourceContextMatch(
        linkedTask,
        linkedTaskSourceContext
      )
        ? linkedTaskSourceContext
        : null,
      comment: typeof raw.comment === 'string' ? raw.comment : '',
      isArchived: raw.isArchived === true,
      isUnread: raw.isUnread === true,
      isPinned: raw.isPinned === true,
      sortOrder:
        typeof raw.sortOrder === 'number' && Number.isFinite(raw.sortOrder) ? raw.sortOrder : now,
      ...(typeof raw.manualOrder === 'number' && Number.isFinite(raw.manualOrder)
        ? { manualOrder: raw.manualOrder }
        : {}),
      ...(typeof raw.workspaceStatus === 'string' && raw.workspaceStatus.trim().length > 0
        ? { workspaceStatus: raw.workspaceStatus }
        : {}),
      ...(isTuiAgent(raw.createdWithAgent) ? { createdWithAgent: raw.createdWithAgent } : {}),
      ...(raw.pendingFirstAgentMessageRename === true
        ? { pendingFirstAgentMessageRename: true }
        : {}),
      ...(typeof raw.firstAgentMessageRenameError === 'string'
        ? { firstAgentMessageRenameError: raw.firstAgentMessageRenameError }
        : raw.firstAgentMessageRenameError === null
          ? { firstAgentMessageRenameError: null }
          : {}),
      lastActivityAt:
        typeof raw.lastActivityAt === 'number' && Number.isFinite(raw.lastActivityAt)
          ? raw.lastActivityAt
          : 0,
      createdAt:
        typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
      updatedAt:
        typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now
    })
  }
  return workspaces.sort(
    (left, right) => right.sortOrder - left.sortOrder || left.name.localeCompare(right.name)
  )
}
