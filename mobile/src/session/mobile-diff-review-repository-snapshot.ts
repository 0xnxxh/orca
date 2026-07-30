import type { MobileGitStatusResult } from '../source-control/mobile-git-status'
import { readMobileGitStatusResult } from './mobile-diff-review-rpc'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readFreshSnapshotIdentity(value: unknown): string | null {
  if (
    !isRecord(value) ||
    value.state !== 'fresh' ||
    typeof value.generation !== 'number' ||
    !Number.isFinite(value.generation) ||
    value.generation !== value.currentGeneration ||
    typeof value.revision !== 'number' ||
    !Number.isFinite(value.revision) ||
    typeof value.identity !== 'string' ||
    value.identity.length === 0
  ) {
    return null
  }
  return value.identity
}

export function readMobileDiffReviewRepositorySnapshot(
  value: unknown
): MobileGitStatusResult | null {
  if (
    !isRecord(value) ||
    !isRecord(value.status) ||
    !Array.isArray(value.status.entries) ||
    value.status.retentionTruncated !== false ||
    !isRecord(value.repositoryIdentity) ||
    !isRecord(value.freshness)
  ) {
    return null
  }
  const statusIdentity = readFreshSnapshotIdentity(value.freshness.status)
  if (
    !statusIdentity ||
    readFreshSnapshotIdentity(value.freshness.repositoryIdentity) !== statusIdentity ||
    readFreshSnapshotIdentity(value.freshness.conflicts) !== statusIdentity
  ) {
    return null
  }
  const head = value.repositoryIdentity.head
  const branch = value.repositoryIdentity.branch
  const conflicts = value.conflicts
  if (
    (head !== null && typeof head !== 'string') ||
    (branch !== null && typeof branch !== 'string') ||
    (conflicts !== null &&
      conflicts !== 'merge' &&
      conflicts !== 'rebase' &&
      conflicts !== 'cherry-pick' &&
      conflicts !== 'unknown')
  ) {
    return null
  }
  const status = readMobileGitStatusResult({
    entries: value.status.entries,
    conflictOperation: conflicts ?? 'unknown',
    ...(head ? { head } : {}),
    ...(branch ? { branch } : {})
  })
  return status && status.entries.length === value.status.entries.length ? status : null
}
