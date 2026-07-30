import { describe, expect, it } from 'vitest'
import { readMobileDiffReviewRepositorySnapshot } from './mobile-diff-review-repository-snapshot'

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
      conflicts: { ...freshness }
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
