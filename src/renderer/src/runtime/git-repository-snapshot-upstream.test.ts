import { describe, expect, it } from 'vitest'
import { readGitRepositorySnapshotUpstream } from './git-repository-snapshot-upstream'

describe('readGitRepositorySnapshotUpstream', () => {
  it('preserves configured upstream and no-upstream producer shapes', () => {
    expect(
      readGitRepositorySnapshotUpstream({
        hasUpstream: true,
        upstreamName: 'origin/feature',
        ahead: 1,
        behind: 2,
        behindCommitsArePatchEquivalent: true
      })
    ).toEqual({
      hasUpstream: true,
      upstreamName: 'origin/feature',
      ahead: 1,
      behind: 2,
      behindCommitsArePatchEquivalent: true
    })
    expect(
      readGitRepositorySnapshotUpstream({
        hasUpstream: false,
        ahead: 0,
        behind: 0,
        hasConfiguredPushTarget: true
      })
    ).toEqual({
      hasUpstream: false,
      ahead: 0,
      behind: 0,
      hasConfiguredPushTarget: true
    })
  })

  it.each([
    ['missing upstream name', { hasUpstream: true, ahead: 0, behind: 0 }],
    ['empty upstream name', { hasUpstream: true, upstreamName: '', ahead: 0, behind: 0 }],
    ['negative count', { hasUpstream: true, upstreamName: 'origin/main', ahead: -1, behind: 0 }],
    ['fractional count', { hasUpstream: true, upstreamName: 'origin/main', ahead: 0, behind: 0.5 }],
    [
      'wrong optional type',
      {
        hasUpstream: true,
        upstreamName: 'origin/main',
        ahead: 0,
        behind: 0,
        behindCommitsArePatchEquivalent: 'yes'
      }
    ],
    [
      'invalid no-upstream shape',
      { hasUpstream: false, upstreamName: 'origin/main', ahead: 0, behind: 0 }
    ],
    [
      'ambiguous divergence',
      { hasUpstream: true, upstreamName: 'origin/main', ahead: 1, behind: 1 }
    ]
  ])('rejects %s', (_label, value) => {
    expect(readGitRepositorySnapshotUpstream(value)).toBeNull()
  })
})
