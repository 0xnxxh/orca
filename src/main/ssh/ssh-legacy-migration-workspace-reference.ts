import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/constants'
import { assertAuthorityStoragePath } from '../../shared/terminal-session-authority-identity'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree-id'
import { failSshLegacyMigrationEvidence } from './ssh-legacy-migration-evidence-capacity'
import type { SshLegacyWorkspaceReference } from './ssh-legacy-migration-evidence-bridge-types'

/**
 * One reading of a legacy client workspace id, shared by persisted layout evidence and live relay
 * inventory rows so both name the same workspace for the same id.
 */
export function sshLegacyClientWorkspaceReference(
  input: Readonly<{
    clientWorkspaceId: string
    folderPathById: ReadonlyMap<string, string>
    floatingWorkspacePath?: string | null
  }>
): SshLegacyWorkspaceReference | null {
  if (input.clientWorkspaceId === FLOATING_TERMINAL_WORKTREE_ID) {
    return Object.freeze({
      kind: 'floating',
      clientWorkspaceId: input.clientWorkspaceId,
      path: input.floatingWorkspacePath ?? null
    })
  }
  const scope = parseWorkspaceKey(input.clientWorkspaceId)
  if (scope?.type === 'folder') {
    const path = input.folderPathById.get(scope.folderWorkspaceId)
    return path
      ? Object.freeze({
          kind: 'folder-workspace',
          clientWorkspaceId: input.clientWorkspaceId,
          path
        })
      : null
  }
  const clientWorkspaceId = scope?.type === 'worktree' ? scope.worktreeId : input.clientWorkspaceId
  const parsed = splitWorktreeIdForFilesystem(clientWorkspaceId)
  if (!parsed?.worktreePath) {
    return null
  }
  assertAuthorityStoragePath(parsed.worktreePath, 'SSH legacy git worktree path')
  return Object.freeze({ kind: 'git-worktree', clientWorkspaceId, path: parsed.worktreePath })
}

export function sshLegacyRequiredWorkspaceReference(
  input: Parameters<typeof sshLegacyClientWorkspaceReference>[0]
): SshLegacyWorkspaceReference {
  const reference = sshLegacyClientWorkspaceReference(input)
  if (reference === null) {
    failSshLegacyMigrationEvidence('malformed', 'persisted workspace owner')
  }
  return reference
}
