import type {
  GitPushTarget,
  GitStatusEntry,
  GitStatusResult,
  GitUpstreamStatus
} from '../../shared/types'
import type {
  GitRepositoryProjectionFreshness,
  GitRepositorySnapshot
} from '../../shared/git-repository-snapshot'
import { stableInFlightKey } from '../../shared/in-flight-promise-dedupe'

export type {
  GitRepositoryProjectionFreshness,
  GitRepositorySnapshot
} from '../../shared/git-repository-snapshot'

export const MAX_GIT_REPOSITORY_SNAPSHOT_STATUS_ENTRIES = 1_000
export const MAX_GIT_REPOSITORY_SNAPSHOT_IGNORED_PATHS = 1_000
export const MAX_GIT_REPOSITORY_SNAPSHOT_TEXT_CODE_UNITS = 64 * 1_024

export type GitRepositoryExecutionIdentity =
  | { kind: 'native' }
  | { kind: 'wsl'; distro: string }
  | { kind: 'ssh-provider'; connectionId: string }

export type GitRepositoryStatusIdentity = {
  includeIgnored: boolean
  reuseLineStats: boolean
  bypassEffectiveUpstreamNegativeCache: boolean
  limit: number | null
  sharedLinkPaths: readonly string[]
}

export type GitRepositoryStatusProjection = {
  repositoryIdentity: Readonly<{ head: string | null; branch: string | null }>
  status: GitRepositorySnapshot['status']
  upstream: Readonly<GitUpstreamStatus> | null
  conflicts: GitStatusResult['conflictOperation']
}

export type GitRepositorySnapshotQuery = {
  executionIdentity: GitRepositoryExecutionIdentity
  worktreePath: string
  statusIdentity: GitRepositoryStatusIdentity
  pushTarget?: GitPushTarget
}

export const EMPTY_GIT_STATUS_ENTRIES = Object.freeze([]) as readonly Readonly<GitStatusEntry>[]
export const EMPTY_GIT_IGNORED_PATHS = Object.freeze([]) as readonly string[]

export function gitRepositoryScopeKey(
  executionIdentity: GitRepositoryExecutionIdentity,
  worktreePath: string
): string {
  return stableInFlightKey([executionIdentity, worktreePath])
}

export function gitRepositoryStatusKey(identity: GitRepositoryStatusIdentity): string {
  return stableInFlightKey([
    identity.includeIgnored,
    identity.reuseLineStats,
    identity.bypassEffectiveUpstreamNegativeCache,
    identity.limit,
    identity.sharedLinkPaths
  ])
}

export function gitRepositoryUpstreamKey(pushTarget: GitPushTarget | undefined): string {
  return stableInFlightKey([
    pushTarget
      ? [
          'explicit-target',
          pushTarget.remoteName,
          pushTarget.branchName,
          pushTarget.remoteUrl ?? null,
          pushTarget.remoteCreated ?? null
        ]
      : ['configured-upstream']
  ])
}

export function freezeGitRepositoryUpstream(
  status: GitUpstreamStatus
): Readonly<GitUpstreamStatus> {
  return Object.freeze({ ...status })
}

function copyBoundedGitStatusEntries(entries: GitStatusEntry[]): {
  entries: readonly Readonly<GitStatusEntry>[]
  textCodeUnits: number
} {
  const retained: Readonly<GitStatusEntry>[] = []
  let textCodeUnits = 0
  for (const entry of entries) {
    const entryCodeUnits = entry.path.length + (entry.oldPath?.length ?? 0)
    if (
      retained.length >= MAX_GIT_REPOSITORY_SNAPSHOT_STATUS_ENTRIES ||
      textCodeUnits + entryCodeUnits > MAX_GIT_REPOSITORY_SNAPSHOT_TEXT_CODE_UNITS
    ) {
      break
    }
    retained.push(
      Object.freeze({
        ...entry,
        ...(entry.submodule ? { submodule: Object.freeze({ ...entry.submodule }) } : {})
      })
    )
    textCodeUnits += entryCodeUnits
  }
  return { entries: Object.freeze(retained), textCodeUnits }
}

function copyBoundedGitIgnoredPaths(
  ignoredPaths: string[],
  textCodeUnits: number
): readonly string[] {
  const retained: string[] = []
  let retainedCodeUnits = textCodeUnits
  for (const ignoredPath of ignoredPaths) {
    if (
      retained.length >= MAX_GIT_REPOSITORY_SNAPSHOT_IGNORED_PATHS ||
      retainedCodeUnits + ignoredPath.length > MAX_GIT_REPOSITORY_SNAPSHOT_TEXT_CODE_UNITS
    ) {
      break
    }
    retained.push(ignoredPath)
    retainedCodeUnits += ignoredPath.length
  }
  return Object.freeze(retained)
}

export function freezeGitRepositoryStatus(result: GitStatusResult): GitRepositoryStatusProjection {
  const boundedEntries = copyBoundedGitStatusEntries(result.entries)
  const ignoredPaths = copyBoundedGitIgnoredPaths(
    result.ignoredPaths ?? [],
    boundedEntries.textCodeUnits
  )
  const retentionTruncated =
    boundedEntries.entries.length !== result.entries.length ||
    ignoredPaths.length !== (result.ignoredPaths?.length ?? 0)
  return Object.freeze({
    repositoryIdentity: Object.freeze({
      head: result.head ?? null,
      branch: result.branch ?? null
    }),
    status: Object.freeze({
      entries: boundedEntries.entries,
      didHitLimit: result.didHitLimit === true,
      statusLength: result.statusLength ?? null,
      ignoredPaths,
      lineStatsState: result.didHitLimit === true ? 'skipped-at-limit' : 'complete',
      retentionTruncated
    }),
    upstream: result.upstreamStatus ? freezeGitRepositoryUpstream(result.upstreamStatus) : null,
    conflicts: result.conflictOperation
  })
}

export function createGitRepositoryProjectionFreshness(
  record:
    | {
        generation: number
        revision: number
        failedGeneration?: number
      }
    | undefined,
  generation: number,
  identity: string
): GitRepositoryProjectionFreshness {
  const state =
    record?.failedGeneration === generation
      ? 'failed'
      : record
        ? record.generation === generation
          ? 'fresh'
          : 'stale'
        : 'missing'
  return Object.freeze({
    state,
    generation: record?.generation ?? generation,
    currentGeneration: generation,
    revision: record?.revision ?? null,
    identity
  })
}
