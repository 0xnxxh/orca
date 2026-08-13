import { describe, expect, it } from 'vitest'
import { readGitHistoryOptions } from './git-history-request-options'

describe('readGitHistoryOptions', () => {
  // Why: every transport used to spell its own whitelist out, so `cursor` reached git on none of
  // them and "Load more" silently re-served page one. This is the one place that can regress now.
  it('carries the cursor through', () => {
    expect(
      readGitHistoryOptions({
        limit: 25,
        baseRef: 'origin/main',
        cursor: { anchor: 'a'.repeat(40), loaded: 50 }
      })
    ).toEqual({
      limit: 25,
      baseRef: 'origin/main',
      cursor: { anchor: 'a'.repeat(40), loaded: 50 }
    })
  })

  it('reads a first-page request', () => {
    expect(readGitHistoryOptions({ limit: 50 })).toEqual({
      limit: 50,
      baseRef: null,
      cursor: undefined
    })
  })

  it.each([
    ['a non-object cursor', 'abc'],
    ['a missing anchor', { loaded: 10 }],
    ['a blank anchor', { anchor: '   ', loaded: 10 }],
    ['a non-string anchor', { anchor: 42, loaded: 10 }],
    ['an abbreviated anchor', { anchor: 'abc123', loaded: 10 }],
    // Why: the anchor is spent on a git revision argument, and requests cross a host boundary
    // (relay, paired web), so an option-shaped anchor must never reach argv.
    ['an option-shaped anchor', { anchor: '--output=/tmp/pwned', loaded: 10 }]
  ])('drops %s', (_label, cursor) => {
    expect(readGitHistoryOptions({ cursor }).cursor).toBeUndefined()
  })

  it.each([
    [-5, 0],
    [12.7, 12],
    [Number.NaN, 0]
  ])('normalizes a loaded offset of %s to %s', (loaded, expected) => {
    const anchor = 'a'.repeat(40)
    expect(readGitHistoryOptions({ cursor: { anchor, loaded } }).cursor).toEqual({
      anchor,
      loaded: expected
    })
  })

  it('accepts a sha-256 object id', () => {
    const anchor = 'b'.repeat(64)
    expect(readGitHistoryOptions({ cursor: { anchor, loaded: 5 } }).cursor).toEqual({
      anchor,
      loaded: 5
    })
  })

  it('ignores a non-numeric limit and a non-string baseRef', () => {
    expect(readGitHistoryOptions({ limit: '50', baseRef: 7 })).toEqual({
      limit: undefined,
      baseRef: null,
      cursor: undefined
    })
  })
})
