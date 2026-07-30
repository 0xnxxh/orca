import { describe, expect, it } from 'vitest'
import {
  readMobileDiffReviewRepositorySnapshot,
  readMobileSourceControlRepositorySnapshot
} from './mobile-git-repository-snapshot'

function snapshot(overrides: Record<string, unknown> = {}) {
  const freshness = {
    state: 'fresh',
    generation: 3,
    currentGeneration: 3,
    revision: 7,
    identity: 'default-status'
  }
  return {
    repositoryIdentity: { head: 'abc123', branch: 'feature/mobile' },
    status: {
      entries: [{ path: 'src/app.ts', status: 'modified', area: 'unstaged' }],
      retentionTruncated: false
    },
    conflicts: 'merge',
    upstream: { hasUpstream: true, ahead: 99, behind: 99 },
    freshness: {
      repositoryIdentity: { ...freshness },
      status: { ...freshness },
      conflicts: { ...freshness },
      upstream: { ...freshness, identity: 'status:default-status' }
    },
    ...overrides
  }
}

describe('mobile diff review repository snapshot parser', () => {
  it('projects only status, repository identity, and conflict state', () => {
    expect(readMobileDiffReviewRepositorySnapshot(snapshot())).toEqual({
      entries: [{ path: 'src/app.ts', status: 'modified', area: 'unstaged' }],
      conflictOperation: 'merge',
      branch: 'feature/mobile',
      head: 'abc123',
      upstreamStatus: undefined
    })
  })

  it.each([
    ['status', 'missing'],
    ['status', 'stale'],
    ['status', 'failed'],
    ['repositoryIdentity', 'stale'],
    ['conflicts', 'stale']
  ] as const)('rejects a %s projection in state %s', (projection, state) => {
    const value = snapshot()
    ;(value.freshness[projection] as Record<string, unknown>).state = state
    expect(readMobileDiffReviewRepositorySnapshot(value)).toBeNull()
  })

  it('rejects truncated, malformed, generation-stale, and identity-mismatched projections', () => {
    const truncated = snapshot()
    truncated.status.retentionTruncated = true
    const malformed = snapshot()
    malformed.status.entries = [{ path: 'src/app.ts', status: 'invalid', area: 'unstaged' }]
    const generationStale = snapshot()
    ;(generationStale.freshness.status as Record<string, unknown>).currentGeneration = 4
    const mismatched = snapshot()
    ;(mismatched.freshness.conflicts as Record<string, unknown>).identity = 'other-status'

    for (const value of [truncated, malformed, generationStale, mismatched]) {
      expect(readMobileDiffReviewRepositorySnapshot(value)).toBeNull()
    }
  })
})

describe('mobile Source Control repository snapshot parser', () => {
  it('projects a fresh configured upstream without equating its identity to status', () => {
    const value = snapshot({
      upstream: { hasUpstream: true, upstreamName: 'origin/main', ahead: 2, behind: 0 }
    })

    expect(readMobileSourceControlRepositorySnapshot(value)).toMatchObject({
      branch: 'feature/mobile',
      head: 'abc123',
      upstreamStatus: {
        hasUpstream: true,
        upstreamName: 'origin/main',
        ahead: 2,
        behind: 0
      }
    })
  })

  it('preserves a fresh no-upstream projection', () => {
    const value = snapshot({
      upstream: { hasUpstream: false, ahead: 0, behind: 0 }
    })

    expect(readMobileSourceControlRepositorySnapshot(value)?.upstreamStatus).toEqual({
      hasUpstream: false,
      ahead: 0,
      behind: 0,
      upstreamName: undefined,
      hasConfiguredPushTarget: undefined,
      behindCommitsArePatchEquivalent: undefined
    })
  })

  it('preserves a fresh no-upstream projection with a configured push target', () => {
    const value = snapshot({
      upstream: {
        hasUpstream: false,
        ahead: 0,
        behind: 0,
        hasConfiguredPushTarget: true
      }
    })

    expect(readMobileSourceControlRepositorySnapshot(value)?.upstreamStatus).toMatchObject({
      hasUpstream: false,
      ahead: 0,
      behind: 0,
      hasConfiguredPushTarget: true
    })
  })

  it.each(['missing', 'stale', 'failed'] as const)(
    'rejects a configured-upstream projection in state %s',
    (state) => {
      const value = snapshot({
        upstream: { hasUpstream: true, upstreamName: 'origin/main', ahead: 0, behind: 0 }
      })
      value.freshness.upstream.state = state
      expect(readMobileSourceControlRepositorySnapshot(value)).toBeNull()
    }
  )

  it.each([
    ['missing upstream name', { hasUpstream: true, ahead: 0, behind: 0 }],
    ['empty upstream name', { hasUpstream: true, upstreamName: '', ahead: 0, behind: 0 }],
    ['wrong-typed upstream name', { hasUpstream: true, upstreamName: 42, ahead: 0, behind: 0 }],
    [
      'wrong-typed configured-push flag',
      {
        hasUpstream: true,
        upstreamName: 'origin/main',
        ahead: 0,
        behind: 0,
        hasConfiguredPushTarget: 'yes'
      }
    ],
    [
      'wrong-typed patch-equivalence flag',
      {
        hasUpstream: true,
        upstreamName: 'origin/main',
        ahead: 1,
        behind: 1,
        behindCommitsArePatchEquivalent: 'yes'
      }
    ]
  ])('rejects %s', (_label, upstream) => {
    expect(readMobileSourceControlRepositorySnapshot(snapshot({ upstream }))).toBeNull()
  })

  it.each([
    ['negative ahead', { hasUpstream: true, upstreamName: 'origin/main', ahead: -1, behind: 0 }],
    ['negative behind', { hasUpstream: true, upstreamName: 'origin/main', ahead: 0, behind: -1 }],
    ['fractional ahead', { hasUpstream: true, upstreamName: 'origin/main', ahead: 0.5, behind: 0 }],
    ['fractional behind', { hasUpstream: true, upstreamName: 'origin/main', ahead: 0, behind: 0.5 }]
  ])('rejects %s', (_label, upstream) => {
    expect(readMobileSourceControlRepositorySnapshot(snapshot({ upstream }))).toBeNull()
  })

  it.each([
    ['an upstream name', { hasUpstream: false, upstreamName: 'origin/main', ahead: 0, behind: 0 }],
    ['a nonzero ahead count', { hasUpstream: false, ahead: 1, behind: 0 }],
    ['a nonzero behind count', { hasUpstream: false, ahead: 0, behind: 1 }],
    [
      'a false configured-push flag',
      { hasUpstream: false, ahead: 0, behind: 0, hasConfiguredPushTarget: false }
    ],
    [
      'patch equivalence',
      { hasUpstream: false, ahead: 0, behind: 0, behindCommitsArePatchEquivalent: false }
    ]
  ])('rejects a no-upstream projection with %s', (_label, upstream) => {
    expect(readMobileSourceControlRepositorySnapshot(snapshot({ upstream }))).toBeNull()
  })

  it('rejects malformed, ambiguous, and generation-mismatched configured upstreams', () => {
    const malformed = snapshot({ upstream: { hasUpstream: true, ahead: 0 } })
    const ambiguous = snapshot({ upstream: { hasUpstream: true, ahead: 1, behind: 1 } })
    const generationMismatched = snapshot({
      upstream: { hasUpstream: true, ahead: 0, behind: 0 }
    })
    generationMismatched.freshness.upstream.generation = 4
    generationMismatched.freshness.upstream.currentGeneration = 4

    for (const value of [malformed, ambiguous, generationMismatched]) {
      expect(readMobileSourceControlRepositorySnapshot(value)).toBeNull()
    }
  })
})
