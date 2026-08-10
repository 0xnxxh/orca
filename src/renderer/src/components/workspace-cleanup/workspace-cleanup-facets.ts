import type { LiveAgentWorktreeStatus } from '@/lib/worktree-activity-state'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../../shared/execution-host'
import type { Worktree, WorkspaceStatusDefinition } from '../../../../shared/types'
import { getWorkspaceStatus } from '../../../../shared/workspace-statuses'
import type { WorkspaceSpaceWorktree } from '../../../../shared/workspace-space-types'
import {
  canSelectWorkspaceCleanupCandidate,
  type WorkspaceCleanupBlocker,
  type WorkspaceCleanupCandidate,
  type WorkspaceCleanupTier
} from '../../../../shared/workspace-cleanup'
import { getWorkspaceCleanupGitState } from './workspace-cleanup-filter-sort'
import type {
  WorkspaceCleanupAgentState,
  WorkspaceCleanupGitState,
  WorkspaceCleanupReviewState,
  WorkspaceCleanupTicketSource
} from '../../../../shared/workspace-cleanup-filter-model'
import type { WorkspaceCleanupReviewInfo } from './workspace-cleanup-presentation'

/** Structural subset of `Worktree` — Pick keeps it in sync when the source type moves. */
export type WorkspaceCleanupWorktreeFacts = Pick<Worktree, 'id'> &
  Partial<
    Pick<
      Worktree,
      | 'workspaceStatus'
      | 'isArchived'
      | 'isPinned'
      | 'isUnread'
      | 'comment'
      | 'hostId'
      | 'branch'
      | 'createdAt'
      | 'linkedWorkItem'
      | 'linkedLinearIssue'
      | 'linkedIssue'
      | 'locked'
      | 'prunable'
    >
  >

export type WorkspaceCleanupFacetSources = {
  worktreeById?: ReadonlyMap<string, WorkspaceCleanupWorktreeFacts>
  workspaceStatuses?: readonly WorkspaceStatusDefinition[]
  /** Absent entry = the space scan never ran for that worktree. */
  sizeBytesByWorktreeId?: ReadonlyMap<string, number>
  lastVisitedAtByWorktreeId?: Readonly<Record<string, number>>
  liveAgentStatusByWorktreeId?: ReadonlyMap<string, LiveAgentWorktreeStatus>
  reviewInfoByWorktreeId?: ReadonlyMap<string, WorkspaceCleanupReviewInfo>
  dismissedWorktreeIds?: ReadonlySet<string>
}

export type WorkspaceCleanupFacets = {
  candidate: WorkspaceCleanupCandidate
  worktreeId: string
  repoId: string
  repoName: string
  displayName: string
  path: string
  branch: string
  hostId: ExecutionHostId
  tier: WorkspaceCleanupTier
  blockers: readonly WorkspaceCleanupBlocker[]
  blockerCount: number
  isDismissed: boolean
  isSelectable: boolean
  /** Background signal: ambient PTY/agent churn bumps this without a human. */
  lastActivityAt: number
  createdAt: number | null
  /** Honest "user opened it" signal; null when Orca never recorded a visit. */
  lastVisitedAt: number | null
  sizeBytes: number | null
  workspaceStatus: string | null
  workspaceStatusLabel: string | null
  isArchived: boolean
  isPinned: boolean
  isUnread: boolean
  hasComment: boolean
  agentState: WorkspaceCleanupAgentState
  retainedDoneAgentCount: number
  gitState: WorkspaceCleanupGitState
  upstreamAhead: number | null
  upstreamBehind: number | null
  isPrunable: boolean
  isLocked: boolean
  review: WorkspaceCleanupReviewInfo
  reviewState: WorkspaceCleanupReviewState | null
  ticketSources: readonly WorkspaceCleanupTicketSource[]
  localContextCount: number
  hasLocalContext: boolean
  isCompletelyEmpty: boolean
  searchText: string
}

const EMPTY_REVIEW_INFO: WorkspaceCleanupReviewInfo = {
  hasReview: false,
  label: null,
  state: null,
  provider: null,
  title: null
}

export function buildWorkspaceCleanupFacets(
  candidate: WorkspaceCleanupCandidate,
  sources: WorkspaceCleanupFacetSources = {}
): WorkspaceCleanupFacets {
  const worktree = sources.worktreeById?.get(candidate.worktreeId) ?? null
  const review = sources.reviewInfoByWorktreeId?.get(candidate.worktreeId) ?? EMPTY_REVIEW_INFO
  const ticketSources = getTicketSources(worktree)
  const localContextCount = getLocalContextCount(candidate)
  const hasComment = (worktree?.comment ?? '').trim().length > 0
  const branch = getBranchDisplayName(worktree?.branch ?? candidate.branch)
  const facets: Omit<WorkspaceCleanupFacets, 'searchText'> = {
    candidate,
    worktreeId: candidate.worktreeId,
    repoId: candidate.repoId,
    repoName: candidate.repoName,
    displayName: candidate.displayName,
    path: candidate.path,
    branch,
    hostId: worktree?.hostId ?? LOCAL_EXECUTION_HOST_ID,
    tier: candidate.tier,
    blockers: candidate.blockers,
    blockerCount: candidate.blockers.length,
    isDismissed:
      (sources.dismissedWorktreeIds?.has(candidate.worktreeId) ?? false) ||
      candidate.blockers.includes('dismissed'),
    isSelectable: canSelectWorkspaceCleanupCandidate(candidate),
    lastActivityAt: candidate.lastActivityAt,
    createdAt: toFiniteOrNull(worktree?.createdAt ?? candidate.createdAt),
    lastVisitedAt: toFiniteOrNull(sources.lastVisitedAtByWorktreeId?.[candidate.worktreeId]),
    sizeBytes: toFiniteOrNull(sources.sizeBytesByWorktreeId?.get(candidate.worktreeId)),
    workspaceStatus: normalizeStatus(worktree?.workspaceStatus),
    workspaceStatusLabel: getWorkspaceStatusLabel(worktree, sources.workspaceStatuses),
    isArchived: worktree?.isArchived ?? candidate.reasons.includes('archived'),
    isPinned: worktree?.isPinned ?? candidate.blockers.includes('pinned'),
    isUnread: worktree?.isUnread ?? false,
    hasComment,
    agentState: sources.liveAgentStatusByWorktreeId?.get(candidate.worktreeId) ?? 'idle',
    retainedDoneAgentCount: candidate.localContext.retainedDoneAgentCount,
    gitState: getWorkspaceCleanupGitState(candidate),
    upstreamAhead: toFiniteOrNull(candidate.git.upstreamAhead),
    upstreamBehind: toFiniteOrNull(candidate.git.upstreamBehind),
    isPrunable: worktree?.prunable ?? false,
    isLocked: worktree?.locked ?? false,
    review,
    reviewState: review.hasReview ? (review.state ?? 'unknown') : null,
    ticketSources,
    localContextCount,
    hasLocalContext: localContextCount > 0,
    isCompletelyEmpty:
      localContextCount === 0 && !review.hasReview && ticketSources.length === 0 && !hasComment
  }
  return { ...facets, searchText: buildSearchText(facets) }
}

export function buildWorkspaceCleanupFacetList(
  candidates: readonly WorkspaceCleanupCandidate[],
  sources: WorkspaceCleanupFacetSources = {}
): WorkspaceCleanupFacets[] {
  return candidates.map((candidate) => buildWorkspaceCleanupFacets(candidate, sources))
}

/** Only `ok` scans carry a trustworthy byte count; everything else stays unsized. */
export function buildWorkspaceCleanupSizeIndex(
  worktrees: readonly WorkspaceSpaceWorktree[] | null | undefined
): Map<string, number> {
  const index = new Map<string, number>()
  for (const entry of worktrees ?? []) {
    if (entry.status === 'ok' && Number.isFinite(entry.sizeBytes)) {
      index.set(entry.worktreeId, entry.sizeBytes)
    }
  }
  return index
}

export function buildWorkspaceCleanupWorktreeIndex(
  worktreesByRepo: Readonly<Record<string, readonly WorkspaceCleanupWorktreeFacts[]>>
): Map<string, WorkspaceCleanupWorktreeFacts> {
  const index = new Map<string, WorkspaceCleanupWorktreeFacts>()
  for (const worktrees of Object.values(worktreesByRepo)) {
    for (const worktree of worktrees) {
      index.set(worktree.id, worktree)
    }
  }
  return index
}

function getLocalContextCount(candidate: WorkspaceCleanupCandidate): number {
  const context = candidate.localContext
  return (
    context.terminalTabCount +
    context.cleanEditorTabCount +
    context.browserTabCount +
    context.diffCommentCount +
    context.retainedDoneAgentCount
  )
}

function getTicketSources(
  worktree: WorkspaceCleanupWorktreeFacts | null
): WorkspaceCleanupTicketSource[] {
  if (!worktree) {
    return []
  }
  const sources: WorkspaceCleanupTicketSource[] = []
  if (worktree.linkedWorkItem != null) {
    sources.push('work-item')
  }
  if ((worktree.linkedLinearIssue ?? '').length > 0) {
    sources.push('linear')
  }
  if (worktree.linkedIssue != null) {
    sources.push('issue')
  }
  return sources
}

function buildSearchText(facets: Omit<WorkspaceCleanupFacets, 'searchText'>): string {
  return [
    facets.displayName,
    facets.repoName,
    facets.branch,
    facets.path,
    facets.hostId,
    facets.workspaceStatus,
    facets.workspaceStatusLabel,
    facets.review.label,
    facets.review.title,
    facets.review.provider,
    facets.gitState,
    facets.tier,
    ...facets.ticketSources,
    ...facets.blockers
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()
}

function normalizeStatus(status: string | undefined): string | null {
  const trimmed = (status ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function getWorkspaceStatusLabel(
  worktree: WorkspaceCleanupWorktreeFacts | null,
  statuses: readonly WorkspaceStatusDefinition[] | undefined
): string | null {
  if (!worktree || !statuses?.length) {
    return null
  }
  const statusId = getWorkspaceStatus({ workspaceStatus: worktree.workspaceStatus }, statuses)
  return statuses.find((status) => status.id === statusId)?.label ?? statusId
}

function toFiniteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getBranchDisplayName(branch: string): string {
  return branch.replace(/^refs\/heads\//, '') || 'HEAD'
}
