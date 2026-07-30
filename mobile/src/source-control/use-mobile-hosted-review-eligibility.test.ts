import { describe, expect, it } from 'vitest'
import type { HostedReviewCreationEligibility } from '../../../src/shared/hosted-review'
import {
  acceptsMobileHostedReviewEligibilityLoad,
  buildMobileHostedReviewEligibilityLoadKey,
  eligibilityStateAfterMobileHostedReviewError,
  renderedMobileHostedReviewEligibilityState,
  shouldFetchMobileHostedReviewEligibility
} from './use-mobile-hosted-review-eligibility'

function eligibility(): HostedReviewCreationEligibility {
  return {
    provider: 'github',
    review: null,
    canCreate: true,
    blockedReason: null,
    nextAction: null,
    defaultBaseRef: 'main',
    title: 'feature',
    body: ''
  }
}

describe('mobile hosted review eligibility loader core', () => {
  it('does not fetch while disconnected or detached', () => {
    expect(
      shouldFetchMobileHostedReviewEligibility({
        client: { sendRequest: async () => ({ ok: true }) } as never,
        connState: 'disconnected',
        branch: 'feature'
      })
    ).toBe(false)
    expect(
      shouldFetchMobileHostedReviewEligibility({
        client: { sendRequest: async () => ({ ok: true }) } as never,
        connState: 'connected',
        branch: null
      })
    ).toBe(false)
  })

  it('accepts only the latest generation for the current worktree branch identity', () => {
    const first = buildMobileHostedReviewEligibilityLoadKey({
      worktreeId: 'wt-1',
      branch: 'feature-a',
      hasUpstream: true,
      ahead: 0,
      behind: 0,
      hasUncommittedChanges: false
    })
    const second = buildMobileHostedReviewEligibilityLoadKey({
      worktreeId: 'wt-1',
      branch: 'feature-b',
      hasUpstream: true,
      ahead: 0,
      behind: 0,
      hasUncommittedChanges: false
    })

    expect(
      acceptsMobileHostedReviewEligibilityLoad({
        generation: 1,
        currentGeneration: 2,
        identity: first.identity,
        currentIdentity: second.identity
      })
    ).toBe(false)
  })

  it('fails closed after errors', () => {
    expect(eligibilityStateAfterMobileHostedReviewError()).toEqual({ kind: 'error' })
  })
})

// #8411: what the hook returns is what paints. A fetch-imminent frame must not
// render as `idle` (hidden row) or the Create PR row pops in a frame later.
describe('rendered eligibility state', () => {
  it('renders fetch-imminent idle and cold loading as an in-flight load seeded from memory', () => {
    const remembered = eligibility()

    for (const state of [
      { kind: 'idle' } as const,
      { kind: 'loading', eligibility: null } as const
    ]) {
      expect(
        renderedMobileHostedReviewEligibilityState({ state, shouldFetch: true, remembered: null })
      ).toEqual({ kind: 'loading', eligibility: null })
      expect(
        renderedMobileHostedReviewEligibilityState({ state, shouldFetch: true, remembered })
      ).toEqual({ kind: 'loading', eligibility: remembered })
    }
  })

  it('passes resolved and refetch states through untouched', () => {
    const ready = { kind: 'ready', eligibility: eligibility() } as const
    const refetch = { kind: 'loading', eligibility: eligibility() } as const
    const error = { kind: 'error' } as const

    for (const state of [ready, refetch, error]) {
      expect(
        renderedMobileHostedReviewEligibilityState({
          state,
          shouldFetch: true,
          remembered: eligibility()
        })
      ).toBe(state)
    }
  })

  it('renders idle when a fetch is not possible, hiding stale snapshots in the same render', () => {
    expect(
      renderedMobileHostedReviewEligibilityState({
        state: { kind: 'ready', eligibility: eligibility() },
        shouldFetch: false,
        remembered: eligibility()
      })
    ).toEqual({ kind: 'idle' })
  })
})
