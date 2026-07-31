import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostedReviewCreationEligibility } from '../../../src/shared/hosted-review'
import {
  forgetAllHostedReviewEligibility,
  recallHostedReviewEligibility,
  rememberHostedReviewEligibility
} from './hosted-review-eligibility-memory'
import {
  acceptsMobileHostedReviewEligibilityLoad,
  buildMobileHostedReviewEligibilityLoadKey,
  eligibilityStateAfterMobileHostedReviewError,
  renderedMobileHostedReviewEligibilityState,
  shouldFetchMobileHostedReviewEligibility,
  useMobileHostedReviewEligibility
} from './use-mobile-hosted-review-eligibility'
import type { MobileCreatePrEligibilityState } from './mobile-create-pr-action'

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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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
      hostId: 'host-1',
      worktreeId: 'wt-1',
      branch: 'feature-a',
      hasUpstream: true,
      ahead: 0,
      behind: 0,
      hasUncommittedChanges: false
    })
    const second = buildMobileHostedReviewEligibilityLoadKey({
      hostId: 'host-1',
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

  it('scopes remembered eligibility to the paired host', () => {
    const input = {
      worktreeId: 'repo-1::/workspace',
      branch: 'feature',
      hasUpstream: true,
      ahead: 0,
      behind: 0,
      hasUncommittedChanges: false
    }
    const local = buildMobileHostedReviewEligibilityLoadKey({ ...input, hostId: 'local' })
    const ssh = buildMobileHostedReviewEligibilityLoadKey({ ...input, hostId: 'ssh-builder' })

    rememberHostedReviewEligibility(local.identity, eligibility())

    expect(local.identity).not.toBe(ssh.identity)
    expect(local.fetch).not.toBe(ssh.fetch)
    expect(recallHostedReviewEligibility(ssh.identity)).toBeNull()
  })

  it('fails closed after errors', () => {
    expect(eligibilityStateAfterMobileHostedReviewError(true)).toEqual({
      kind: 'error',
      reserveSpace: true
    })
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
      ).toEqual({ kind: 'loading', eligibility: null, reserveSpace: true })
      expect(
        renderedMobileHostedReviewEligibilityState({ state, shouldFetch: true, remembered })
      ).toEqual({ kind: 'loading', eligibility: remembered, reserveSpace: false })
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

describe('eligibility request ordering', () => {
  let renderer: ReactTestRenderer | null = null
  let renderedState: MobileCreatePrEligibilityState = { kind: 'idle' }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    forgetAllHostedReviewEligibility()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('does not let an older response overwrite the newest remembered answer', async () => {
    type Response = { ok: true; result: HostedReviewCreationEligibility }
    const requests: Array<ReturnType<typeof deferred<Response>>> = []
    const client = {
      sendRequest: vi.fn(() => {
        const request = deferred<Response>()
        requests.push(request)
        return request.promise
      })
    }
    const newest = eligibility({ canCreate: false, blockedReason: 'existing_review' })
    const older = eligibility()

    function Harness({ dirty }: { dirty: boolean }): null {
      renderedState = useMobileHostedReviewEligibility({
        client: client as never,
        connState: 'connected',
        hostId: 'host-1',
        worktreeId: 'wt-1',
        branch: 'feature',
        hasUpstream: true,
        ahead: 0,
        behind: 0,
        hasUncommittedChanges: dirty
      })
      return null
    }

    await act(async () => {
      renderer = create(createElement(Harness, { dirty: false }))
      await Promise.resolve()
    })
    await act(async () => {
      renderer?.update(createElement(Harness, { dirty: true }))
      await Promise.resolve()
    })
    expect(requests).toHaveLength(2)

    await act(async () => {
      requests[1]!.resolve({ ok: true, result: newest })
      await Promise.resolve()
    })
    await act(async () => {
      requests[0]!.resolve({ ok: true, result: older })
      await Promise.resolve()
    })

    const key = buildMobileHostedReviewEligibilityLoadKey({
      hostId: 'host-1',
      worktreeId: 'wt-1',
      branch: 'feature',
      hasUpstream: true,
      ahead: 0,
      behind: 0,
      hasUncommittedChanges: true
    })
    expect(recallHostedReviewEligibility(key.identity)).toBe(newest)

    act(() => renderer?.unmount())
    renderer = null
    await act(async () => {
      renderer = create(createElement(Harness, { dirty: true }))
      await Promise.resolve()
    })
    expect(renderedState).toMatchObject({ kind: 'loading', eligibility: newest })
  })
})
