import type { LiveAgentWorktreeStatus } from '@/lib/worktree-activity-state'
import type { WorkspaceStatusDefinition } from '../../../../shared/types'
import type { WorkspaceCleanupCandidate } from '../../../../shared/workspace-cleanup'
import {
  buildWorkspaceCleanupFacets,
  type WorkspaceCleanupFacetSources,
  type WorkspaceCleanupFacets
} from './workspace-cleanup-facets'
import {
  getWorkspaceCleanupReviewInfo,
  type WorkspaceCleanupRendererStateInputs,
  type WorkspaceCleanupReviewInfo,
  type WorkspaceCleanupReviewLookup
} from './workspace-cleanup-presentation'
import {
  getWorkspaceCleanupCandidateHostId,
  getWorkspaceCleanupHostIdentity
} from './workspace-cleanup-host-identity'

/**
 * Streaming ticks replace only the candidate objects they touched, so all
 * per-candidate work here is cached on candidate object identity; unchanged
 * rows reuse their previous facet/review objects and the row array itself
 * keeps identity when nothing changed, which is what lets React.memo and
 * downstream memos hold.
 */
type SourceToken = readonly unknown[]

function tokensEqual(left: SourceToken, right: SourceToken): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export type WorkspaceCleanupReviewInfoCache = {
  token: SourceToken
  byCandidate: WeakMap<WorkspaceCleanupCandidate, WorkspaceCleanupReviewInfo>
}

export function computeWorkspaceCleanupReviewInfoIndex(args: {
  candidates: readonly WorkspaceCleanupCandidate[]
  candidateIdCounts: ReadonlyMap<string, number>
  reviewSources: WorkspaceCleanupRendererStateInputs
  reviewLookup: WorkspaceCleanupReviewLookup
  cache: WorkspaceCleanupReviewInfoCache | null
}): { cache: WorkspaceCleanupReviewInfoCache; infos: Map<string, WorkspaceCleanupReviewInfo> } {
  const { candidates, candidateIdCounts, reviewSources, reviewLookup } = args
  const token: SourceToken = [
    reviewSources.hostedReviewCache,
    reviewSources.repos,
    reviewSources.settings,
    reviewSources.worktreesByRepo
  ]
  let cache = args.cache
  if (!cache || !tokensEqual(cache.token, token)) {
    cache = { token, byCandidate: new WeakMap() }
  }
  const infos = new Map<string, WorkspaceCleanupReviewInfo>()
  for (const candidate of candidates) {
    let info = cache.byCandidate.get(candidate)
    if (info === undefined) {
      info = getWorkspaceCleanupReviewInfo(candidate, reviewSources, reviewLookup)
      cache.byCandidate.set(candidate, info)
    }
    infos.set(
      getWorkspaceCleanupHostIdentity(
        getWorkspaceCleanupCandidateHostId(candidate),
        candidate.worktreeId
      ),
      info
    )
    if (candidateIdCounts.get(candidate.worktreeId) === 1) {
      infos.set(candidate.worktreeId, info)
    }
  }
  return { cache, infos }
}

type FacetCacheEntry = {
  facet: WorkspaceCleanupFacets
  sizeBytes: number | null | undefined
  lastVisitedAt: number | undefined
  agentState: LiveAgentWorktreeStatus | undefined
  review: WorkspaceCleanupReviewInfo | undefined
  isDismissed: boolean
}

export type WorkspaceCleanupFacetListCache = {
  token: SourceToken
  byCandidate: WeakMap<WorkspaceCleanupCandidate, FacetCacheEntry>
  lastList: WorkspaceCleanupFacets[]
}

export function computeWorkspaceCleanupFacetList(args: {
  candidates: readonly WorkspaceCleanupCandidate[]
  sources: Required<Omit<WorkspaceCleanupFacetSources, 'workspaceStatuses'>> & {
    workspaceStatuses: readonly WorkspaceStatusDefinition[]
  }
  cache: WorkspaceCleanupFacetListCache | null
}): { cache: WorkspaceCleanupFacetListCache; list: WorkspaceCleanupFacets[] } {
  const { candidates, sources } = args
  const token: SourceToken = [sources.worktreeById, sources.workspaceStatuses]
  let cache = args.cache
  if (!cache || !tokensEqual(cache.token, token)) {
    cache = { token, byCandidate: new WeakMap(), lastList: [] }
  }
  const list = candidates.map((candidate) => {
    const hostIdentity = getWorkspaceCleanupHostIdentity(
      getWorkspaceCleanupCandidateHostId(candidate),
      candidate.worktreeId
    )
    // Per-id projections mirror buildWorkspaceCleanupFacets' lookups; the
    // cached facet is valid only while every projected input is unchanged.
    const sizeBytes =
      sources.sizeBytesByWorktreeId.get(hostIdentity) ??
      sources.sizeBytesByWorktreeId.get(candidate.worktreeId)
    const lastVisitedAt = sources.lastVisitedAtByWorktreeId[candidate.worktreeId]
    const agentState = sources.liveAgentStatusByWorktreeId.get(candidate.worktreeId)
    const review =
      sources.reviewInfoByWorktreeId.get(hostIdentity) ??
      sources.reviewInfoByWorktreeId.get(candidate.worktreeId)
    const isDismissed = sources.dismissedWorktreeIds.has(candidate.worktreeId)
    const cached = cache.byCandidate.get(candidate)
    if (
      cached &&
      cached.sizeBytes === sizeBytes &&
      cached.lastVisitedAt === lastVisitedAt &&
      cached.agentState === agentState &&
      cached.review === review &&
      cached.isDismissed === isDismissed
    ) {
      return cached.facet
    }
    const facet = buildWorkspaceCleanupFacets(candidate, sources)
    cache.byCandidate.set(candidate, {
      facet,
      sizeBytes,
      lastVisitedAt,
      agentState,
      review,
      isDismissed
    })
    return facet
  })
  // Why: reusing the previous array identity when no row changed lets every
  // downstream memo skip its O(N) pass on no-op streaming ticks.
  const previous = cache.lastList
  if (previous.length === list.length && list.every((facet, index) => facet === previous[index])) {
    return { cache, list: previous }
  }
  cache.lastList = list
  return { cache, list }
}
