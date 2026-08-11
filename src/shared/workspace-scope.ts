import { parseExecutionHostId, type ExecutionHostId } from './execution-host'
import type { WorkspaceKey, WorkspaceScope } from './types'

type ParsedWorkspaceScope =
  | Extract<WorkspaceScope, { type: 'worktree' }>
  | { type: 'folder'; folderWorkspaceId: string; ownerHostId?: ExecutionHostId }

export function worktreeWorkspaceKey(worktreeId: string): WorkspaceKey {
  return `worktree:${worktreeId}`
}

export function folderWorkspaceKey(
  folderWorkspaceId: string,
  ownerHostId?: ExecutionHostId
): WorkspaceKey {
  if (ownerHostId) {
    return `folder:${encodeURIComponent(ownerHostId)}:${encodeURIComponent(folderWorkspaceId)}`
  }
  return `folder:${folderWorkspaceId}`
}

export function parseWorkspaceKey(value: string): ParsedWorkspaceScope | null {
  if (value.startsWith('worktree:')) {
    const worktreeId = value.slice('worktree:'.length)
    return worktreeId.length > 0 ? { type: 'worktree', worktreeId } : null
  }
  if (value.startsWith('folder:')) {
    const rest = value.slice('folder:'.length)
    if (rest.length === 0) {
      return null
    }
    const separator = rest.indexOf(':')
    if (separator > 0) {
      try {
        const ownerHostId = parseExecutionHostId(decodeURIComponent(rest.slice(0, separator)))?.id
        const folderWorkspaceId = decodeURIComponent(rest.slice(separator + 1))
        if (ownerHostId && folderWorkspaceId.length > 0) {
          return { type: 'folder', folderWorkspaceId, ownerHostId }
        }
      } catch {
        // Legacy folder ids remain valid even when percent-decoding fails.
      }
    }
    return { type: 'folder', folderWorkspaceId: rest }
  }
  return null
}

export function isWorkspaceKey(value: string): value is WorkspaceKey {
  return parseWorkspaceKey(value) !== null
}

// Why: folder workspaces are tracked by the scoped active key, while older
// worktree-only paths still read activeWorktreeId.
export function getActiveSidebarWorkspaceId(
  activeWorkspaceKey: string | null,
  activeWorktreeId: string | null
): string | null {
  const scope = activeWorkspaceKey ? parseWorkspaceKey(activeWorkspaceKey) : null
  if (scope?.type === 'folder') {
    return folderWorkspaceKey(scope.folderWorkspaceId, scope.ownerHostId)
  }
  if (scope?.type === 'worktree') {
    return scope.worktreeId
  }
  return activeWorktreeId
}
