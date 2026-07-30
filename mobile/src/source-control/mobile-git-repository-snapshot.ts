import type { MobileGitStatusResult, MobileGitUpstreamStatus } from './mobile-git-status'
import { readMobileGitStatusResult, readMobileGitUpstreamStatus } from './mobile-git-status-rpc'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

type FreshSnapshotProjection = {
  identity: string
  generation: number
}

function readFreshSnapshotProjection(value: unknown): FreshSnapshotProjection | null {
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
  return { identity: value.identity, generation: value.currentGeneration }
}

function readMobileRepositoryStatusProjection(value: unknown): MobileGitStatusResult | null {
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
  const statusProjection = readFreshSnapshotProjection(value.freshness.status)
  const repositoryIdentityProjection = readFreshSnapshotProjection(
    value.freshness.repositoryIdentity
  )
  const conflictsProjection = readFreshSnapshotProjection(value.freshness.conflicts)
  if (
    !statusProjection ||
    !repositoryIdentityProjection ||
    !conflictsProjection ||
    repositoryIdentityProjection.identity !== statusProjection.identity ||
    conflictsProjection.identity !== statusProjection.identity ||
    repositoryIdentityProjection.generation !== statusProjection.generation ||
    conflictsProjection.generation !== statusProjection.generation
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

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function readMobileRepositoryUpstream(value: unknown): MobileGitUpstreamStatus | null {
  if (
    !isRecord(value) ||
    typeof value.hasUpstream !== 'boolean' ||
    typeof value.ahead !== 'number' ||
    !Number.isSafeInteger(value.ahead) ||
    value.ahead < 0 ||
    typeof value.behind !== 'number' ||
    !Number.isSafeInteger(value.behind) ||
    value.behind < 0
  ) {
    return null
  }
  const hasUpstreamName = hasOwn(value, 'upstreamName')
  const hasConfiguredPushTarget = hasOwn(value, 'hasConfiguredPushTarget')
  const hasPatchEquivalence = hasOwn(value, 'behindCommitsArePatchEquivalent')
  if (
    (hasConfiguredPushTarget && typeof value.hasConfiguredPushTarget !== 'boolean') ||
    (hasPatchEquivalence && typeof value.behindCommitsArePatchEquivalent !== 'boolean')
  ) {
    return null
  }
  if (value.hasUpstream) {
    if (typeof value.upstreamName !== 'string' || value.upstreamName.length === 0) {
      return null
    }
  } else if (
    value.ahead !== 0 ||
    value.behind !== 0 ||
    hasUpstreamName ||
    hasPatchEquivalence ||
    (hasConfiguredPushTarget && value.hasConfiguredPushTarget !== true)
  ) {
    return null
  }
  return readMobileGitUpstreamStatus(value) ?? null
}

export function readMobileDiffReviewRepositorySnapshot(
  value: unknown
): MobileGitStatusResult | null {
  return readMobileRepositoryStatusProjection(value)
}

export function readMobileSourceControlRepositorySnapshot(
  value: unknown
): MobileGitStatusResult | null {
  if (!isRecord(value) || !isRecord(value.freshness)) {
    return null
  }
  const statusProjection = readFreshSnapshotProjection(value.freshness.status)
  const upstreamProjection = readFreshSnapshotProjection(value.freshness.upstream)
  const status = readMobileRepositoryStatusProjection(value)
  const upstreamStatus = readMobileRepositoryUpstream(value.upstream)
  if (
    !statusProjection ||
    !upstreamProjection ||
    upstreamProjection.generation !== statusProjection.generation ||
    !status ||
    !upstreamStatus ||
    (!upstreamStatus.hasUpstream && (upstreamStatus.ahead !== 0 || upstreamStatus.behind !== 0)) ||
    (upstreamStatus.ahead > 0 &&
      upstreamStatus.behind > 0 &&
      upstreamStatus.behindCommitsArePatchEquivalent === undefined)
  ) {
    return null
  }
  return { ...status, upstreamStatus }
}
