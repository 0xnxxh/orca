import { useMemo } from 'react'
import { parseWslUncPath } from '../../../../shared/wsl-paths'
import { splitWorktreeIdForFilesystem } from '../../../../shared/worktree-id'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import {
  createNormalizedPathInsideOrEqualMatcher,
  isRuntimePathAbsolute,
  normalizeRuntimePathForComparison
} from '../../../../shared/cross-platform-path'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { Repo, Worktree } from '../../../../shared/types'
import { aiVaultWorktreeCompactPath } from './ai-vault-session-worktree-affordances'

export {
  aiVaultWorktreeCompactPath,
  aiVaultWorktreeJumpTooltip,
  aiVaultWorktreeStatusLabel,
  canJumpToAiVaultSessionWorktree,
  isAiVaultSessionInCurrentWorktree,
  shouldShowAiVaultSessionWorktreeLine,
  shouldShowAiVaultWorktreeStatusBadge
} from './ai-vault-session-worktree-affordances'

export type AiVaultSessionWorktreeStatus = 'current' | 'active' | 'archived' | 'unavailable'

export type AiVaultSessionWorktreeInfo = {
  status: AiVaultSessionWorktreeStatus
  label: string
  path: string
  worktreeId?: string
}

type WorktreeCandidate = {
  worktree: Worktree
  path: string
  hostId: ExecutionHostId
  status: Exclude<AiVaultSessionWorktreeStatus, 'current'>
  source: 'current-path' | 'prior-path'
  /** Precomputed so a fan-out over sessions does not re-normalize per session. */
  matches: (normalizedSessionCwd: string) => boolean
  comparisonPathLength: number
}

/**
 * Candidate list for one (worktrees, repos) pair.
 *
 * Why cache: resolving a session walks every candidate, so a panel with N
 * sessions rebuilt the same list N times — 1000+ allocations and path
 * normalizations per session. The list only depends on its two inputs, both of
 * which are referentially stable in the store, so one WeakMap hop replaces it.
 */
const candidateCache = new WeakMap<object, WeakMap<object, WorktreeCandidate[]>>()

// Why a shared constant: a `repos = []` default would allocate a fresh array per
// call, so every lookup would miss the cache keyed on that array's identity.
const NO_REPOS: readonly Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>[] = []

export function resolveAiVaultSessionWorktreeInfo({
  session,
  repos = NO_REPOS,
  worktrees,
  activeWorktreeId
}: {
  session: AiVaultSession
  repos?: readonly Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>[]
  worktrees: readonly Worktree[]
  activeWorktreeId: string | null
}): AiVaultSessionWorktreeInfo | null {
  if (!session.cwd) {
    return null
  }

  const sessionHostId = normalizeExecutionHostId(session.executionHostId)
  // Normalize the session cwd once, then test it against precomputed matchers.
  const normalizedSessionCwd = normalizeRuntimePathForComparison(session.cwd)

  // Single pass picking the max, rather than filter+filter+sort: the result is
  // just the best candidate, and sorting 1000+ entries per session dominated.
  let best: WorktreeCandidate | undefined
  for (const candidate of getWorktreeCandidates(worktrees, repos)) {
    if (sessionHostId && candidate.hostId !== sessionHostId) {
      continue
    }
    if (!candidate.matches(normalizedSessionCwd)) {
      continue
    }
    if (!best || compareWorktreeCandidates(candidate, best) < 0) {
      best = candidate
    }
  }

  if (!best) {
    return {
      status: 'unavailable',
      label: compactPathLabel(session.cwd),
      path: session.cwd
    }
  }

  const status =
    best.worktree.id === activeWorktreeId
      ? 'current'
      : best.worktree.isArchived
        ? 'archived'
        : best.status

  return {
    status,
    label: best.worktree.displayName || compactPathLabel(best.path),
    path: best.path,
    worktreeId: best.worktree.id
  }
}

export function extractWorktreePathFromSessionTitle(title: string): string | null {
  const trimmed = title.trim()
  if (!trimmed) {
    return null
  }

  const suffixMatch = trimmed.match(/\s-\s*Worktree:\s*(.+)$/i)
  if (suffixMatch?.[1]) {
    return suffixMatch[1].trim()
  }

  const inlineMatch = trimmed.match(/\bWorktree:\s*(.+)$/i)
  return inlineMatch?.[1]?.trim() ?? null
}

export function resolveAiVaultSessionWorktreeDisplay(args: {
  session: AiVaultSession
  repos?: readonly Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>[]
  worktrees: readonly Worktree[]
  activeWorktreeId: string | null
}): AiVaultSessionWorktreeInfo | null {
  const resolved = resolveAiVaultSessionWorktreeInfo(args)
  if (resolved) {
    return resolved
  }

  const cwd = args.session.cwd?.trim()
  if (cwd) {
    return unavailableWorktreeInfo(cwd)
  }

  const titlePath = extractWorktreePathFromSessionTitle(args.session.title)
  if (titlePath) {
    return unavailableWorktreeInfo(titlePath)
  }

  const branch = args.session.branch?.trim()
  if (branch) {
    return {
      status: 'unavailable',
      label: branch,
      path: branch
    }
  }

  return null
}

export function useAiVaultSessionWorktreeMap({
  sessions,
  repos = NO_REPOS,
  worktrees,
  activeWorktreeId
}: {
  sessions: readonly AiVaultSession[]
  repos?: readonly Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>[]
  worktrees: readonly Worktree[]
  activeWorktreeId: string | null
}): ReadonlyMap<string, AiVaultSessionWorktreeInfo> {
  return useMemo(
    () =>
      new Map(
        sessions.flatMap((session) => {
          const worktreeInfo = resolveAiVaultSessionWorktreeDisplay({
            session,
            repos,
            worktrees,
            activeWorktreeId
          })
          return worktreeInfo ? [[session.id, worktreeInfo] as const] : []
        })
      ),
    [activeWorktreeId, repos, sessions, worktrees]
  )
}

function getWorktreeCandidates(
  worktrees: readonly Worktree[],
  repos: readonly Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>[]
): WorktreeCandidate[] {
  let byRepos = candidateCache.get(worktrees)
  if (!byRepos) {
    byRepos = new WeakMap()
    candidateCache.set(worktrees, byRepos)
  }
  let candidates = byRepos.get(repos)
  if (!candidates) {
    candidates = buildWorktreeCandidates(worktrees, repos)
    byRepos.set(repos, candidates)
  }
  return candidates
}

function buildWorktreeCandidates(
  worktrees: readonly Worktree[],
  repos: readonly Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>[]
): WorktreeCandidate[] {
  const candidates: WorktreeCandidate[] = []
  const repoById = new Map(repos.map((repo) => [repo.id, repo]))
  const push = (
    worktree: Worktree,
    candidatePath: string,
    hostId: ExecutionHostId,
    source: WorktreeCandidate['source']
  ): void => {
    candidates.push({
      worktree,
      path: candidatePath,
      hostId,
      status: worktree.isArchived ? 'archived' : 'active',
      source,
      matches: createWorktreePathMatcher(candidatePath),
      comparisonPathLength: normalizeRuntimePathForComparison(candidatePath).length
    })
  }
  for (const worktree of worktrees) {
    const repo = repoById.get(worktree.repoId)
    const hostId =
      normalizeExecutionHostId(worktree.hostId) ??
      (repo ? getRepoExecutionHostId(repo) : LOCAL_EXECUTION_HOST_ID)
    if (hasUsablePath(worktree.path)) {
      push(worktree, worktree.path, hostId, 'current-path')
    }
    for (const priorWorktreeId of worktree.priorWorktreeIds ?? []) {
      const parsed = splitWorktreeIdForFilesystem(priorWorktreeId)
      if (!parsed || parsed.repoId !== worktree.repoId || !hasUsablePath(parsed.worktreePath)) {
        continue
      }
      push(worktree, parsed.worktreePath, hostId, 'prior-path')
    }
  }
  return candidates
}

function hasUsablePath(pathValue: string): boolean {
  const trimmed = pathValue.trim()
  return Boolean(trimmed && isRuntimePathAbsolute(trimmed))
}

/**
 * Builds the containment test for one worktree path, so the per-session loop
 * only normalizes the session cwd. Keeps the WSL fallback: a UNC worktree path
 * must also match sessions recorded under the Linux-side path.
 */
function createWorktreePathMatcher(
  worktreePath: string
): (normalizedSessionCwd: string) => boolean {
  const direct = createNormalizedPathInsideOrEqualMatcher(worktreePath)
  const wslPath = parseWslUncPath(worktreePath)
  if (!wslPath) {
    return direct
  }
  const viaLinuxPath = createNormalizedPathInsideOrEqualMatcher(wslPath.linuxPath)
  return (normalizedSessionCwd) =>
    direct(normalizedSessionCwd) || viaLinuxPath(normalizedSessionCwd)
}

function compareWorktreeCandidates(left: WorktreeCandidate, right: WorktreeCandidate): number {
  const lengthDifference = right.comparisonPathLength - left.comparisonPathLength
  if (lengthDifference !== 0) {
    return lengthDifference
  }
  if (left.source === right.source) {
    return 0
  }
  return left.source === 'current-path' ? -1 : 1
}

function unavailableWorktreeInfo(pathValue: string): AiVaultSessionWorktreeInfo {
  return {
    status: 'unavailable',
    label: compactPathLabel(pathValue),
    path: pathValue
  }
}

function compactPathLabel(pathValue: string): string {
  return aiVaultWorktreeCompactPath(pathValue)
}
