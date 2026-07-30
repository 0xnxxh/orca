import { beforeEach, describe, expect, it } from 'vitest'
import type { HostedReviewCreationEligibility } from '../../../src/shared/hosted-review'
import {
  forgetAllHostedReviewEligibility,
  recallHostedReviewEligibility,
  rememberHostedReviewEligibility
} from './hosted-review-eligibility-memory'

function eligibility(
  overrides: Partial<HostedReviewCreationEligibility> = {}
): HostedReviewCreationEligibility {
  return {
    provider: 'github',
    review: null,
    canCreate: true,
    blockedReason: null,
    nextAction: null,
    defaultBaseRef: 'main',
    title: 'feature',
    body: '',
    ...overrides
  }
}

describe('hosted review eligibility memory', () => {
  beforeEach(() => {
    forgetAllHostedReviewEligibility()
  })

  it('recalls the last remembered answer per identity', () => {
    const first = eligibility()
    const blocked = eligibility({ canCreate: false, blockedReason: 'existing_review' })

    rememberHostedReviewEligibility('wt-1\0feature', first)
    rememberHostedReviewEligibility('wt-1\0other', blocked)

    expect(recallHostedReviewEligibility('wt-1\0feature')).toBe(first)
    expect(recallHostedReviewEligibility('wt-1\0other')).toBe(blocked)
    expect(recallHostedReviewEligibility('wt-2\0feature')).toBeNull()
  })

  it('overwrites an identity with its newest answer', () => {
    const newest = eligibility({ canCreate: false, blockedReason: 'needs_push' })

    rememberHostedReviewEligibility('wt-1\0feature', eligibility())
    rememberHostedReviewEligibility('wt-1\0feature', newest)

    expect(recallHostedReviewEligibility('wt-1\0feature')).toBe(newest)
  })

  it('evicts the least recently remembered identity beyond the bound', () => {
    for (let i = 0; i < 64; i++) {
      rememberHostedReviewEligibility(`wt-${i}`, eligibility())
    }
    // Refresh wt-0 so wt-1 is now the oldest.
    rememberHostedReviewEligibility('wt-0', eligibility())
    rememberHostedReviewEligibility('wt-64', eligibility())

    expect(recallHostedReviewEligibility('wt-1')).toBeNull()
    expect(recallHostedReviewEligibility('wt-0')).not.toBeNull()
    expect(recallHostedReviewEligibility('wt-64')).not.toBeNull()
  })
})
