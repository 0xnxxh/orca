import { describe, expect, it } from 'vitest'
import { resolveChecksPanelPRRefreshRequest } from './checks-panel-pr-refresh-request'

describe('resolveChecksPanelPRRefreshRequest', () => {
  it('uses an active refresh for a cached miss from before the checks panel became visible', () => {
    expect(
      resolveChecksPanelPRRefreshRequest({
        cachedHasPR: false,
        cachedFetchedAt: 100,
        panelVisibleSince: 200
      })
    ).toEqual({ reason: 'active', priority: 80 })
  })

  it('keeps fresh empty lookups on the background path', () => {
    expect(
      resolveChecksPanelPRRefreshRequest({
        cachedHasPR: false,
        cachedFetchedAt: 200,
        panelVisibleSince: 100
      })
    ).toEqual({ reason: 'swr', priority: 30 })
  })

  it('foreground-fetches a known-but-unrendered review so the panel resolves off the transient card', () => {
    expect(
      resolveChecksPanelPRRefreshRequest({
        cachedHasPR: null,
        cachedFetchedAt: null,
        panelVisibleSince: 200,
        hasUnrenderedReviewEvidence: true
      })
    ).toEqual({ reason: 'active', priority: 80 })
  })

  it('does not repeatedly force provider work for the same unrendered review evidence', () => {
    expect(
      resolveChecksPanelPRRefreshRequest({
        cachedHasPR: false,
        cachedFetchedAt: 100,
        panelVisibleSince: 200,
        hasUnrenderedReviewEvidence: true,
        hasRequestedForegroundRefresh: true
      })
    ).toEqual({ reason: 'swr', priority: 30 })
  })

  it('does not force provider work when review details are already cached', () => {
    expect(
      resolveChecksPanelPRRefreshRequest({
        cachedHasPR: true,
        cachedFetchedAt: 100,
        panelVisibleSince: 200,
        hasUnrenderedReviewEvidence: true
      })
    ).toEqual({ reason: 'swr', priority: 30 })
  })

  it('does not promote non-GitHub review evidence into an active GitHub lookup', () => {
    expect(
      resolveChecksPanelPRRefreshRequest({
        cachedHasPR: null,
        cachedFetchedAt: null,
        panelVisibleSince: 200,
        hasUnrenderedReviewEvidence: true,
        reviewEvidenceProvider: 'gitlab'
      })
    ).toEqual({ reason: 'swr', priority: 30 })
  })

  it('keeps populated or unknown cache entries on the background path', () => {
    expect(
      resolveChecksPanelPRRefreshRequest({
        cachedHasPR: true,
        cachedFetchedAt: 100,
        panelVisibleSince: 200
      })
    ).toEqual({ reason: 'swr', priority: 30 })

    expect(
      resolveChecksPanelPRRefreshRequest({
        cachedHasPR: null,
        cachedFetchedAt: null,
        panelVisibleSince: 200
      })
    ).toEqual({ reason: 'swr', priority: 30 })
  })
})
