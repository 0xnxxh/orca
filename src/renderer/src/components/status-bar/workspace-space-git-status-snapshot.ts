import type {
  GitConflictOperation,
  GitStatusEntry,
  GitStatusResult,
  GitUpstreamStatus,
  GlobalSettings
} from '../../../../shared/types'
import {
  getRuntimeGitRepositorySnapshot,
  type RuntimeGitRepositorySnapshotOptions
} from '@/runtime/runtime-git-repository-snapshot-client'
import {
  refreshGitStatusForWorktree,
  type GitStatusRefreshDeps
} from '../right-sidebar/git-status-refresh'
import { readWorkspaceSpaceSnapshotUpstream } from './workspace-space-git-snapshot-upstream'

export type WorkspaceSpaceGitStatusContext = {
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  worktreeId: string
  worktreePath: string
  connectionId?: string
  expectedBranch: string
}

type WorkspaceSpaceGitStatusLoadRequest = {
  signal?: AbortSignal
  shouldStart: () => boolean
  shouldContinue: () => boolean
}

type WorkspaceSpaceGitStatusSnapshotDependencies = {
  getSnapshot: typeof getRuntimeGitRepositorySnapshot
  refreshFresh: typeof refreshGitStatusForWorktree
}

const defaultDependencies: WorkspaceSpaceGitStatusSnapshotDependencies = {
  getSnapshot: getRuntimeGitRepositorySnapshot,
  refreshFresh: refreshGitStatusForWorktree
}

type AdmittedWorkspaceSpaceGitStatus = {
  revision: number
  status: GitStatusResult
  upstream: GitUpstreamStatus
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isOptionalString(value: Record<string, unknown>, key: string): boolean {
  return !hasOwn(value, key) || typeof value[key] === 'string'
}

function isOptionalNonnegativeInteger(value: Record<string, unknown>, key: string): boolean {
  return (
    !hasOwn(value, key) ||
    (typeof value[key] === 'number' &&
      Number.isSafeInteger(value[key]) &&
      (value[key] as number) >= 0)
  )
}

function readGitStatusEntry(value: unknown): GitStatusEntry | null {
  if (
    !isRecord(value) ||
    typeof value.path !== 'string' ||
    value.path.length === 0 ||
    (value.status !== 'modified' &&
      value.status !== 'added' &&
      value.status !== 'deleted' &&
      value.status !== 'renamed' &&
      value.status !== 'untracked' &&
      value.status !== 'copied') ||
    (value.area !== 'staged' && value.area !== 'unstaged' && value.area !== 'untracked') ||
    !isOptionalString(value, 'oldPath') ||
    !isOptionalString(value, 'submoduleRoot') ||
    !isOptionalNonnegativeInteger(value, 'added') ||
    !isOptionalNonnegativeInteger(value, 'removed') ||
    (hasOwn(value, 'conflictKind') &&
      value.conflictKind !== 'both_modified' &&
      value.conflictKind !== 'both_added' &&
      value.conflictKind !== 'both_deleted' &&
      value.conflictKind !== 'added_by_us' &&
      value.conflictKind !== 'added_by_them' &&
      value.conflictKind !== 'deleted_by_us' &&
      value.conflictKind !== 'deleted_by_them') ||
    (hasOwn(value, 'conflictStatus') &&
      value.conflictStatus !== 'unresolved' &&
      value.conflictStatus !== 'resolved_locally') ||
    (hasOwn(value, 'conflictStatusSource') &&
      value.conflictStatusSource !== 'git' &&
      value.conflictStatusSource !== 'session')
  ) {
    return null
  }
  if (hasOwn(value, 'submodule')) {
    const submodule = value.submodule
    if (
      !isRecord(submodule) ||
      typeof submodule.commitChanged !== 'boolean' ||
      typeof submodule.trackedChanges !== 'boolean' ||
      typeof submodule.untrackedChanges !== 'boolean'
    ) {
      return null
    }
  }
  return { ...value } as GitStatusEntry
}

type FreshProjection = {
  identity: string
  generation: number
  revision: number
}

function readFreshProjection(value: unknown): FreshProjection | null {
  if (
    !isRecord(value) ||
    value.state !== 'fresh' ||
    typeof value.generation !== 'number' ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 0 ||
    value.generation !== value.currentGeneration ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.identity !== 'string' ||
    value.identity.length === 0
  ) {
    return null
  }
  return {
    identity: value.identity,
    generation: value.generation,
    revision: value.revision
  }
}

function readConflictOperation(value: unknown): GitConflictOperation | null {
  return value === 'merge' || value === 'rebase' || value === 'cherry-pick' || value === 'unknown'
    ? value
    : null
}

export function readWorkspaceSpaceGitStatusSnapshot(
  value: unknown,
  expectedBranch: string
): AdmittedWorkspaceSpaceGitStatus | null {
  if (
    !isRecord(value) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.generatedAt !== 'number' ||
    !Number.isFinite(value.generatedAt) ||
    value.generatedAt < 0 ||
    typeof value.worktreeGraphVersion !== 'number' ||
    !Number.isSafeInteger(value.worktreeGraphVersion) ||
    value.worktreeGraphVersion < 0 ||
    !isRecord(value.freshness) ||
    !isRecord(value.repositoryIdentity) ||
    !isRecord(value.status) ||
    value.repositoryIdentity.branch !== expectedBranch ||
    (value.repositoryIdentity.head !== null && typeof value.repositoryIdentity.head !== 'string') ||
    value.status.retentionTruncated !== false ||
    !Array.isArray(value.status.entries) ||
    !Array.isArray(value.status.ignoredPaths) ||
    !value.status.ignoredPaths.every((path) => typeof path === 'string') ||
    typeof value.status.didHitLimit !== 'boolean' ||
    (value.status.statusLength !== null &&
      (typeof value.status.statusLength !== 'number' ||
        !Number.isSafeInteger(value.status.statusLength) ||
        value.status.statusLength < 0)) ||
    (value.status.lineStatsState !== 'missing' &&
      value.status.lineStatsState !== 'complete' &&
      value.status.lineStatsState !== 'skipped-at-limit')
  ) {
    return null
  }
  const statusFreshness = readFreshProjection(value.freshness.status)
  const repositoryFreshness = readFreshProjection(value.freshness.repositoryIdentity)
  const conflictFreshness = readFreshProjection(value.freshness.conflicts)
  const upstreamFreshness = readFreshProjection(value.freshness.upstream)
  if (
    !statusFreshness ||
    !repositoryFreshness ||
    !conflictFreshness ||
    !upstreamFreshness ||
    repositoryFreshness.identity !== statusFreshness.identity ||
    conflictFreshness.identity !== statusFreshness.identity ||
    repositoryFreshness.generation !== statusFreshness.generation ||
    conflictFreshness.generation !== statusFreshness.generation ||
    upstreamFreshness.generation !== statusFreshness.generation ||
    repositoryFreshness.revision !== statusFreshness.revision ||
    conflictFreshness.revision !== statusFreshness.revision
  ) {
    return null
  }
  const entries = value.status.entries.map(readGitStatusEntry)
  const conflictOperation = readConflictOperation(value.conflicts)
  const upstream = readWorkspaceSpaceSnapshotUpstream(value.upstream)
  if (entries.includes(null) || !conflictOperation || !upstream) {
    return null
  }
  const status: GitStatusResult = {
    entries: entries as GitStatusEntry[],
    conflictOperation,
    ...(value.repositoryIdentity.head === null
      ? {}
      : { head: value.repositoryIdentity.head as string }),
    branch: expectedBranch,
    upstreamStatus: upstream,
    ignoredPaths: [...value.status.ignoredPaths],
    ...(value.status.didHitLimit ? { didHitLimit: true } : {}),
    ...(value.status.statusLength === null
      ? {}
      : { statusLength: value.status.statusLength as number })
  }
  return { revision: statusFreshness.revision, status, upstream }
}

async function readNewestWorkspaceSpaceSnapshot(
  context: WorkspaceSpaceGitStatusContext,
  getSnapshot: typeof getRuntimeGitRepositorySnapshot
): Promise<AdmittedWorkspaceSpaceGitStatus | null> {
  const options: readonly RuntimeGitRepositorySnapshotOptions[] = [{}, { reuseLineStats: true }]
  const results = await Promise.allSettled(
    options.map((identity) => getSnapshot(context, identity))
  )
  let newest: AdmittedWorkspaceSpaceGitStatus | null = null
  for (const result of results) {
    if (result.status !== 'fulfilled') {
      continue
    }
    const admitted = readWorkspaceSpaceGitStatusSnapshot(result.value, context.expectedBranch)
    if (admitted && (!newest || admitted.revision > newest.revision)) {
      newest = admitted
    }
  }
  return newest
}

export async function loadWorkspaceSpaceGitStatus({
  context,
  deps,
  request,
  dependencies = defaultDependencies
}: {
  context: WorkspaceSpaceGitStatusContext
  deps: GitStatusRefreshDeps
  request: WorkspaceSpaceGitStatusLoadRequest
  dependencies?: WorkspaceSpaceGitStatusSnapshotDependencies
}): Promise<'snapshot' | 'fresh' | 'cancelled'> {
  if (!request.shouldStart() || request.signal?.aborted) {
    return 'cancelled'
  }
  const snapshot = await readNewestWorkspaceSpaceSnapshot(context, dependencies.getSnapshot)
  if (!request.shouldStart() || request.signal?.aborted) {
    return 'cancelled'
  }
  if (snapshot) {
    deps.setGitStatus(context.worktreeId, snapshot.status)
    deps.updateWorktreeGitIdentity(context.worktreeId, {
      head: snapshot.status.head,
      branch: snapshot.status.branch ?? (snapshot.status.head ? null : undefined)
    })
    deps.setUpstreamStatus(context.worktreeId, snapshot.upstream)
    return 'snapshot'
  }
  let ownsFreshStatus = false
  const shouldApplyFresh = (): boolean =>
    request.signal?.aborted !== true &&
    (ownsFreshStatus ? request.shouldContinue() : request.shouldStart())
  const freshDeps: GitStatusRefreshDeps = {
    ...deps,
    setGitStatus: (worktreeId, status) => {
      if (!shouldApplyFresh()) {
        return
      }
      ownsFreshStatus = true
      deps.setGitStatus(worktreeId, status)
    },
    updateWorktreeGitIdentity: (worktreeId, identity) => {
      if (ownsFreshStatus && shouldApplyFresh()) {
        deps.updateWorktreeGitIdentity(worktreeId, identity)
      }
    },
    setUpstreamStatus: (worktreeId, upstream) => {
      if (ownsFreshStatus && shouldApplyFresh()) {
        deps.setUpstreamStatus(worktreeId, upstream)
      }
    }
  }
  await dependencies.refreshFresh({
    settings: context.settings,
    worktreeId: context.worktreeId,
    worktreePath: context.worktreePath,
    connectionId: context.connectionId,
    deps: freshDeps,
    request: {
      ...(request.signal ? { signal: request.signal } : {}),
      shouldApply: shouldApplyFresh
    }
  })
  return ownsFreshStatus && shouldApplyFresh() ? 'fresh' : 'cancelled'
}
