import type { ExecutionHostId } from './execution-host'
import type { WorkspaceKey, WorkspaceScope } from './types'

export function worktreeWorkspaceKey(worktreeId: string): WorkspaceKey {
  return `worktree:${worktreeId}`
}

/** Owner-qualified folder session keys keep same-id multi-host rows independent. */
export function folderWorkspaceKey(
  folderWorkspaceId: string,
  ownerHostId?: ExecutionHostId
): WorkspaceKey {
  if (ownerHostId) {
    return `folder:${encodeURIComponent(ownerHostId)}:${encodeURIComponent(folderWorkspaceId)}`
  }
  return `folder:${folderWorkspaceId}`
}

export function parseWorkspaceKey(value: string): WorkspaceScope | null {
  if (value.startsWith('worktree:')) {
    const worktreeId = value.slice('worktree:'.length)
    return worktreeId.length > 0 ? { type: 'worktree', worktreeId } : null
  }
  if (value.startsWith('folder:')) {
    const rest = value.slice('folder:'.length)
    if (rest.length === 0) {
      return null
    }
    // Why: owner-qualified keys encode both segments so host ids with colons stay unambiguous.
    const separator = rest.indexOf(':')
    if (separator > 0) {
      try {
        const ownerHostId = decodeURIComponent(rest.slice(0, separator)) as ExecutionHostId
        const folderWorkspaceId = decodeURIComponent(rest.slice(separator + 1))
        if (ownerHostId.length > 0 && folderWorkspaceId.length > 0) {
          return { type: 'folder', folderWorkspaceId, ownerHostId }
        }
      } catch {
        // Fall through to legacy id-only form when decoding fails.
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

export function folderWorkspaceSessionKeys(args: {
  folderWorkspaceId: string
  ownerHostId: ExecutionHostId
}): string[] {
  return [
    folderWorkspaceKey(args.folderWorkspaceId, args.ownerHostId),
    // Why: older sessions still key by bare folder id; purge both so one owner cleanup cannot leave the legacy alias behind for the deleted row only when it was sole occupant is handled by callers.
    folderWorkspaceKey(args.folderWorkspaceId)
  ]
}

/**
 * Dual-read contract for owner-qualified folder session keys:
 * prefer the canonical owner-qualified key, then fall back to the legacy bare
 * `folder:<id>` alias so pre-migration tabs/state keep resolving for that owner.
 */
export function dualReadFolderWorkspaceKeyedValue<T>(
  get: (key: string) => T | undefined,
  args: { folderWorkspaceId: string; ownerHostId: ExecutionHostId }
): { value: T; key: string; viaLegacyAlias: boolean } | null {
  const qualified = folderWorkspaceKey(args.folderWorkspaceId, args.ownerHostId)
  const fromQualified = get(qualified)
  if (fromQualified !== undefined) {
    return { value: fromQualified, key: qualified, viaLegacyAlias: false }
  }
  const bare = folderWorkspaceKey(args.folderWorkspaceId)
  const fromBare = get(bare)
  if (fromBare !== undefined) {
    return { value: fromBare, key: bare, viaLegacyAlias: true }
  }
  return null
}

/**
 * Migrate legacy bare `folder:<id>` map keys to owner-qualified form when the
 * catalog can resolve an unambiguous owner. Multi-owner same-id bare keys stay
 * untouched so callers can fail closed instead of guessing.
 */
export function migrateFolderWorkspaceKeyedRecord<T>(
  record: Record<string, T>,
  resolveUnambiguousOwner: (folderWorkspaceId: string) => ExecutionHostId | null
): { record: Record<string, T>; migratedKeys: string[] } {
  const migratedKeys: string[] = []
  let next: Record<string, T> | null = null
  for (const [key, value] of Object.entries(record)) {
    const scope = parseWorkspaceKey(key)
    if (scope?.type !== 'folder' || scope.ownerHostId) {
      continue
    }
    const ownerHostId = resolveUnambiguousOwner(scope.folderWorkspaceId)
    if (!ownerHostId) {
      continue
    }
    const qualified = folderWorkspaceKey(scope.folderWorkspaceId, ownerHostId)
    if (qualified === key) {
      continue
    }
    if (!next) {
      next = { ...record }
    }
    // Why: if both forms already exist, keep the canonical owner-qualified row.
    if (!(qualified in next)) {
      next[qualified] = value
    }
    delete next[key]
    migratedKeys.push(key)
  }
  return { record: next ?? record, migratedKeys }
}
