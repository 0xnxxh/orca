import type { GitRepositorySnapshot } from '../../../../shared/git-repository-snapshot'
import type { GitStatusResult } from '../../../../shared/types'
import {
  getDesktopGitRepositorySnapshot,
  type DesktopGitRepositorySnapshotContext
} from '@/runtime/desktop-git-repository-snapshot-client'
import { getRuntimeGitStatus } from '@/runtime/runtime-git-client'

type DeleteWorktreeDirtyStatusProbeDependencies = {
  getSnapshot: typeof getDesktopGitRepositorySnapshot
  getFreshStatus: typeof getRuntimeGitStatus
}

const defaultDependencies: DeleteWorktreeDirtyStatusProbeDependencies = {
  getSnapshot: getDesktopGitRepositorySnapshot,
  getFreshStatus: getRuntimeGitStatus
}

export function readDeleteWorktreeDirtyStatusSnapshot(
  snapshot: GitRepositorySnapshot | null
): GitStatusResult | null {
  const statusIdentity = snapshot?.freshness.status.identity
  if (
    !snapshot ||
    snapshot.freshness.status.state !== 'fresh' ||
    !statusIdentity ||
    snapshot.freshness.status.revision === null ||
    snapshot.freshness.repositoryIdentity.state !== 'fresh' ||
    snapshot.freshness.repositoryIdentity.identity !== statusIdentity ||
    snapshot.freshness.conflicts.state !== 'fresh' ||
    snapshot.freshness.conflicts.identity !== statusIdentity ||
    snapshot.status.retentionTruncated
  ) {
    return null
  }
  return {
    entries: [...snapshot.status.entries],
    conflictOperation: snapshot.conflicts ?? 'unknown',
    ...(snapshot.repositoryIdentity.head ? { head: snapshot.repositoryIdentity.head } : {}),
    ...(snapshot.repositoryIdentity.branch ? { branch: snapshot.repositoryIdentity.branch } : {}),
    ignoredPaths: [...snapshot.status.ignoredPaths],
    ...(snapshot.status.didHitLimit ? { didHitLimit: true } : {}),
    ...(snapshot.status.statusLength === null ? {} : { statusLength: snapshot.status.statusLength })
  }
}

export async function probeDeleteWorktreeDirtyStatus(
  context: DesktopGitRepositorySnapshotContext,
  shouldCommit: () => boolean,
  commit: (status: GitStatusResult) => void,
  dependencies: DeleteWorktreeDirtyStatusProbeDependencies = defaultDependencies
): Promise<void> {
  if (!shouldCommit()) {
    return
  }
  const snapshotReads = await Promise.allSettled([
    dependencies.getSnapshot(context),
    dependencies.getSnapshot(context, { reuseLineStats: true })
  ])
  if (!shouldCommit()) {
    return
  }
  let newestStatusProjection: { revision: number; status: GitStatusResult } | null = null
  for (const result of snapshotReads) {
    if (result.status === 'fulfilled') {
      const snapshot = result.value
      if (!snapshot) {
        continue
      }
      const status = readDeleteWorktreeDirtyStatusSnapshot(snapshot)
      const statusRevision = snapshot.freshness.status.revision
      if (
        status &&
        statusRevision !== null &&
        (!newestStatusProjection || statusRevision > newestStatusProjection.revision)
      ) {
        newestStatusProjection = { revision: statusRevision, status }
      }
    }
  }
  if (newestStatusProjection) {
    commit(newestStatusProjection.status)
    return
  }
  try {
    const status = await dependencies.getFreshStatus(context)
    if (shouldCommit()) {
      commit(status)
    }
  } catch {
    // Warning-only: removal still performs the authoritative dirty preflight.
  }
}
