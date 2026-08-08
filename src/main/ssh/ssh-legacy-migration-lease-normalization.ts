import type { SshRemotePtyLease } from '../../shared/ssh-types'
import { sshLegacyPhysicalPtyId } from './ssh-legacy-migration-evidence-identity'
import type {
  SshLegacyUnresolvedPaneEvidence,
  SshLegacyWorkspaceReference
} from './ssh-legacy-migration-evidence-bridge-types'
import type { SshLegacyLayoutPaneEvidence } from './ssh-legacy-migration-inventory-types'

export type SshLegacyResolvedPane = Readonly<{
  raw: SshLegacyUnresolvedPaneEvidence
  pane: SshLegacyLayoutPaneEvidence
}>

export function normalizeSshLegacyPtyLeases(
  targetId: string,
  leases: readonly Readonly<SshRemotePtyLease>[],
  localPanes: readonly SshLegacyResolvedPane[]
): readonly SshRemotePtyLease[] {
  return leases.map((lease) => {
    const physicalPtyId = sshLegacyPhysicalPtyId(targetId, lease.ptyId)
    const candidates = localPanes.filter(
      ({ raw, pane }) =>
        physicalPtyId !== null &&
        sshLegacyPhysicalPtyId(targetId, raw.ptyId) === physicalPtyId &&
        lease.tabId === raw.tabId &&
        lease.leafId === raw.leafId &&
        leaseWorkspaceMatches(lease.worktreeId, raw.workspaceReference, pane.workspace)
    )
    if (candidates.length !== 1) {
      return Object.freeze({ ...lease })
    }
    const { worktreeId: _worktreeId, ...evidence } = lease
    void _worktreeId
    const workspace = candidates[0].pane.workspace
    return Object.freeze({
      ...evidence,
      ...(workspace.kind === 'git-worktree' ? { worktreeId: workspace.worktreeId } : {})
    })
  })
}

function leaseWorkspaceMatches(
  leaseWorktreeId: string | undefined,
  reference: SshLegacyWorkspaceReference,
  workspace: SshLegacyLayoutPaneEvidence['workspace']
): boolean {
  if (workspace.kind === 'git-worktree') {
    return (
      leaseWorktreeId === workspace.worktreeId ||
      ('clientWorkspaceId' in reference && leaseWorktreeId === reference.clientWorkspaceId)
    )
  }
  return (
    leaseWorktreeId === undefined ||
    ('clientWorkspaceId' in reference && leaseWorktreeId === reference.clientWorkspaceId)
  )
}
