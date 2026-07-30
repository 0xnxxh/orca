import { describe, expect, it } from 'vitest'
import {
  resolveCreateReviewIntentEligibility,
  type CreateReviewIntentKind
} from './source-control-create-review-intent'
import type { HostedReviewCreationBlockedReason } from './hosted-review'
import type { GitUpstreamStatus } from './git-status-types'

function unavailableEligibility(blockedReason: HostedReviewCreationBlockedReason) {
  return {
    provider: 'github' as const,
    review: null,
    canCreate: false,
    blockedReason,
    nextAction: null,
    reviewLookupOutcome: 'unavailable' as const
  }
}

describe('resolveCreateReviewIntentEligibility', () => {
  it.each<{
    blockedReason: HostedReviewCreationBlockedReason
    expectedKind: CreateReviewIntentKind
    stagedCount?: number
    hasStageableChanges?: boolean
    branchCommitsAhead?: number
    upstreamStatus?: GitUpstreamStatus
  }>([
    {
      blockedReason: 'dirty',
      expectedKind: 'dirty',
      hasStageableChanges: true
    },
    {
      blockedReason: 'no_upstream',
      expectedKind: 'no_upstream',
      branchCommitsAhead: 1,
      upstreamStatus: { hasUpstream: false, ahead: 0, behind: 0 }
    },
    {
      blockedReason: 'needs_push',
      expectedKind: 'needs_push',
      upstreamStatus: {
        hasUpstream: true,
        upstreamName: 'origin/feature',
        ahead: 1,
        behind: 0
      }
    },
    {
      blockedReason: 'needs_sync',
      expectedKind: 'needs_sync',
      upstreamStatus: {
        hasUpstream: true,
        upstreamName: 'origin/feature',
        ahead: 0,
        behind: 1
      }
    },
    {
      blockedReason: 'needs_sync',
      expectedKind: 'force_push',
      branchCommitsAhead: 1,
      upstreamStatus: {
        hasUpstream: true,
        upstreamName: 'origin/feature',
        ahead: 2,
        behind: 1,
        behindCommitsArePatchEquivalent: true
      }
    }
  ])(
    'keeps recoverable $expectedKind preparation eligible when review lookup is unavailable',
    ({
      blockedReason,
      expectedKind,
      stagedCount = 0,
      hasStageableChanges = false,
      branchCommitsAhead,
      upstreamStatus
    }) => {
      expect(
        resolveCreateReviewIntentEligibility({
          stagedCount,
          hasStageableChanges,
          hasMessage: true,
          hasUnresolvedConflicts: false,
          upstreamStatus,
          hostedReviewCreation: unavailableEligibility(blockedReason),
          branchCommitsAhead
        })
      ).toEqual({ eligible: true, kind: expectedKind })
    }
  )
})
