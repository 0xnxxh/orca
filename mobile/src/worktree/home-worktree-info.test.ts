import { describe, expect, it } from 'vitest'
import {
  HOME_WORKTREE_COUNTS_STALE_MAX_AGE_MS,
  homeHostWorktreeSummary,
  markHomeWorktreeCatalogUnavailable,
  type HostWorktreeInfo
} from './home-worktree-info'

describe('markHomeWorktreeCatalogUnavailable', () => {
  it('marks a host unavailable when no catalog has loaded', () => {
    expect(markHomeWorktreeCatalogUnavailable(undefined, 'host-1')).toEqual({
      hostId: 'host-1',
      totalWorktrees: 0,
      activeCount: 0,
      lastActiveWorktree: null,
      catalogUnavailable: true
    })
  })

  it('marks cached counts unavailable without discarding the cached snapshot', () => {
    const current: HostWorktreeInfo = {
      hostId: 'host-1',
      totalWorktrees: 3,
      activeCount: 1,
      lastActiveWorktree: {
        worktreeId: 'worktree-1',
        repo: 'orca',
        branch: 'feature',
        displayName: 'Feature',
        liveTerminalCount: 1
      }
    }

    expect(markHomeWorktreeCatalogUnavailable(current, 'host-1')).toEqual({
      ...current,
      catalogUnavailable: true,
      staleCounts: true
    })
  })

  it('reuses an already unavailable snapshot to avoid repeated render churn', () => {
    const current: HostWorktreeInfo = {
      hostId: 'host-1',
      totalWorktrees: 0,
      activeCount: 0,
      lastActiveWorktree: null,
      catalogUnavailable: true
    }

    expect(markHomeWorktreeCatalogUnavailable(current, 'host-1')).toBe(current)
  })
})

describe('homeHostWorktreeSummary', () => {
  const provenAt = 1_700_000_000_000
  const loaded: HostWorktreeInfo = {
    hostId: 'host-1',
    totalWorktrees: 12,
    activeCount: 2,
    lastActiveWorktree: null,
    countsProvenAt: provenAt
  }

  it('summarizes a freshly loaded catalog', () => {
    expect(homeHostWorktreeSummary(loaded, provenAt)).toBe('12 worktrees · 2 active')
    expect(
      homeHostWorktreeSummary({ ...loaded, totalWorktrees: 1, activeCount: 0 }, provenAt)
    ).toBe('1 worktree')
  })

  it('keeps showing the last proven counts after a failed refresh', () => {
    const afterFailure = markHomeWorktreeCatalogUnavailable(loaded, 'host-1')

    expect(homeHostWorktreeSummary(afterFailure, provenAt + 30_000)).toBe(
      'Last known: 12 worktrees · 2 active'
    )
  })

  it('stops calling aged-out counts "last known"', () => {
    const afterFailure = markHomeWorktreeCatalogUnavailable(loaded, 'host-1')

    expect(
      homeHostWorktreeSummary(afterFailure, provenAt + HOME_WORKTREE_COUNTS_STALE_MAX_AGE_MS)
    ).toBe('Last known: 12 worktrees · 2 active')
    // A snapshot rehydrated from a previous app session describes a host we have not reached.
    expect(
      homeHostWorktreeSummary(afterFailure, provenAt + HOME_WORKTREE_COUNTS_STALE_MAX_AGE_MS + 1)
    ).toBe('Worktree list unavailable')
    expect(homeHostWorktreeSummary(afterFailure, provenAt + 3 * 86_400_000)).toBe(
      'Worktree list unavailable'
    )
  })

  it('treats counts persisted before age stamping as unproven', () => {
    const preUpgrade: HostWorktreeInfo = { ...loaded, countsProvenAt: undefined }

    expect(
      homeHostWorktreeSummary(markHomeWorktreeCatalogUnavailable(preUpgrade, 'host-1'), provenAt)
    ).toBe('Worktree list unavailable')
  })

  it('reports unavailable only when no catalog ever loaded', () => {
    expect(homeHostWorktreeSummary(markHomeWorktreeCatalogUnavailable(undefined, 'host-1'))).toBe(
      'Worktree list unavailable'
    )
    expect(homeHostWorktreeSummary(undefined)).toBeNull()
  })
})
