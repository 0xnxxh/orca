import { describe, expect, it } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import {
  countFleetFocusCards,
  filterFleetFocusCards,
  finishedCardMatchesScope
} from './fleet-rings-focus-filter'

const NOW = 2_000_000_000

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'pane-1',
    ptyId: 'pty-1',
    agentType: 'codex',
    bucket: 'done',
    dotState: 'done',
    task: '',
    repoId: 'repo-1',
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    repoName: 'Orca',
    worktreeName: 'Fleet rings',
    startedAt: NOW - 60_000,
    finishedAt: NOW - 30_000,
    stateChangedAt: NOW - 30_000,
    unseen: false,
    hostKind: 'local',
    ...overrides
  }
}

describe('fleet rings focus filtering', () => {
  it('uses explicit review membership independently from seen state', () => {
    const result = card()
    expect(finishedCardMatchesScope(result, 'review', NOW, new Set())).toBe(true)
    expect(finishedCardMatchesScope(result, 'review', NOW, new Set([result.paneKey]))).toBe(false)
  })

  it('bounds history scopes by the finished timestamp', () => {
    const recent = card({ paneKey: 'recent', finishedAt: NOW - 23 * 60 * 60_000 })
    const old = card({ paneKey: 'old', finishedAt: NOW - 8 * 24 * 60 * 60_000 })

    expect(finishedCardMatchesScope(recent, 'day', NOW, new Set())).toBe(true)
    expect(finishedCardMatchesScope(old, 'week', NOW, new Set())).toBe(false)
    expect(finishedCardMatchesScope(old, 'all', NOW, new Set())).toBe(true)
  })

  it('lets pinned results bypass local Focus filters', () => {
    const pinned = card({ paneKey: 'pinned', repoId: 'hidden', hostKind: 'ssh' })
    const visible = filterFleetFocusCards({
      cards: [pinned],
      enabledStates: new Set(),
      finishedScope: 'review',
      hostFilter: 'local',
      hiddenProjectIds: new Set(['hidden']),
      pinnedPaneKeys: new Set(['pinned']),
      reviewedPaneKeys: new Set(['pinned']),
      now: NOW
    })

    expect(visible).toEqual([pinned])
  })

  it('reports state and finished-window counts from the same card set', () => {
    const cards = [
      card({ paneKey: 'done-new', unseen: true }),
      card({ paneKey: 'done-reviewed' }),
      card({ paneKey: 'working', bucket: 'working', dotState: 'working', finishedAt: null }),
      card({ paneKey: 'waiting', bucket: 'attention', dotState: 'waiting', finishedAt: null })
    ]

    expect(countFleetFocusCards(cards, NOW, new Set(['done-reviewed']))).toMatchObject({
      attention: 1,
      working: 1,
      finished: 2,
      review: 1,
      day: 2,
      week: 2,
      all: 2
    })
  })
})
