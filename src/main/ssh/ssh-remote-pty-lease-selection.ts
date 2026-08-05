import type { SshRemotePtyLease } from '../../shared/ssh-types'

export type SshRemotePtyLeaseSelection = {
  candidates: SshRemotePtyLease[]
  discardedDuplicates: SshRemotePtyLease[]
}

function completePaneKey(lease: SshRemotePtyLease): string | null {
  if (!lease.worktreeId || !lease.tabId || !lease.leafId) {
    return null
  }
  return [lease.targetId, lease.worktreeId, lease.tabId, lease.leafId].join('\0')
}

function isNewerLease(candidate: SshRemotePtyLease, incumbent: SshRemotePtyLease): boolean {
  if (candidate.updatedAt !== incumbent.updatedAt) {
    return candidate.updatedAt > incumbent.updatedAt
  }
  if (candidate.createdAt !== incumbent.createdAt) {
    return candidate.createdAt > incumbent.createdAt
  }
  return candidate.ptyId > incumbent.ptyId
}

export function selectSshRemotePtyLeasesForReattach(
  leases: readonly SshRemotePtyLease[]
): SshRemotePtyLeaseSelection {
  const activeLeases = leases.filter(
    (lease) => lease.state !== 'terminated' && lease.state !== 'expired'
  )
  const winnerByPaneKey = new Map<string, SshRemotePtyLease>()

  for (const lease of activeLeases) {
    const paneKey = completePaneKey(lease)
    if (!paneKey) {
      continue
    }
    const incumbent = winnerByPaneKey.get(paneKey)
    if (!incumbent || isNewerLease(lease, incumbent)) {
      winnerByPaneKey.set(paneKey, lease)
    }
  }

  const candidates: SshRemotePtyLease[] = []
  const discardedDuplicates: SshRemotePtyLease[] = []
  for (const lease of activeLeases) {
    const paneKey = completePaneKey(lease)
    if (!paneKey || winnerByPaneKey.get(paneKey) === lease) {
      candidates.push(lease)
    } else {
      discardedDuplicates.push(lease)
    }
  }
  return { candidates, discardedDuplicates }
}
