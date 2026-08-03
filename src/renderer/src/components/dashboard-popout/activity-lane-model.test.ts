import { describe, expect, it } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import {
  ACTIVITY_LANE_OLDER_AFTER_MS,
  activityTimelineBounds,
  buildActivityLanes,
  filterActivityLaneCards
} from './activity-lane-model'

const NOW = 10 * 60 * 60 * 1_000

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'parent',
    ptyId: 'pty-parent',
    agentType: 'codex',
    bucket: 'working',
    dotState: 'working',
    task: 'Implement activity lanes',
    repoId: 'repo-1',
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    repoName: 'Orca',
    worktreeName: 'dashboard',
    startedAt: NOW - 60 * 60 * 1_000,
    finishedAt: null,
    stateChangedAt: NOW - 30 * 60 * 1_000,
    lastResponseAt: NOW - 5 * 60 * 1_000,
    unseen: false,
    ...overrides
  }
}

describe('activity lane model', () => {
  it('keeps cross-worktree children beneath their parent while preserving their card labels', () => {
    const parent = card()
    const child = card({
      paneKey: 'child',
      parentPaneKey: parent.paneKey,
      worktreeId: 'worktree-2',
      worktreeName: 'child-worktree',
      startedAt: NOW - 45 * 60 * 1_000
    })
    const grandchild = card({
      paneKey: 'grandchild',
      parentPaneKey: child.paneKey,
      worktreeId: 'worktree-3',
      worktreeName: 'nested-worktree',
      startedAt: NOW - 30 * 60 * 1_000
    })

    const lanes = buildActivityLanes([grandchild, child, parent])

    expect(lanes).toHaveLength(1)
    expect(lanes[0].worktreeName).toBe('dashboard')
    expect(lanes[0].cards.map((item) => [item.paneKey, item.worktreeName])).toEqual([
      ['parent', 'dashboard'],
      ['child', 'child-worktree'],
      ['grandchild', 'nested-worktree']
    ])
  })

  it('keeps active cards visible and collapses stale completed cards until requested', () => {
    const active = card({ paneKey: 'active', startedAt: NOW - 3 * 60 * 60 * 1_000 })
    const recentDone = card({
      paneKey: 'recent-done',
      bucket: 'done',
      dotState: 'done',
      finishedAt: NOW - 30 * 60 * 1_000,
      lastResponseAt: NOW - 30 * 60 * 1_000
    })
    const oldDone = card({
      paneKey: 'old-done',
      bucket: 'done',
      dotState: 'done',
      finishedAt: NOW - ACTIVITY_LANE_OLDER_AFTER_MS - 1,
      lastResponseAt: NOW - ACTIVITY_LANE_OLDER_AFTER_MS - 1
    })

    expect(
      filterActivityLaneCards([active, recentDone, oldDone], {
        now: NOW,
        recentMinutes: 1_440,
        status: 'all',
        showOlder: false
      }).map((item) => item.paneKey)
    ).toEqual(['active', 'recent-done'])
    expect(
      filterActivityLaneCards([active, recentDone, oldDone], {
        now: NOW,
        recentMinutes: 1_440,
        status: 'all',
        showOlder: true
      }).map((item) => item.paneKey)
    ).toEqual(['active', 'recent-done', 'old-done'])
  })

  it('keeps a filtered ancestor as context for a visible child', () => {
    const parent = card({
      paneKey: 'old-parent',
      bucket: 'done',
      dotState: 'done',
      finishedAt: NOW - ACTIVITY_LANE_OLDER_AFTER_MS - 1,
      lastResponseAt: NOW - ACTIVITY_LANE_OLDER_AFTER_MS - 1
    })
    const child = card({
      paneKey: 'recent-child',
      parentPaneKey: parent.paneKey,
      bucket: 'done',
      dotState: 'done',
      finishedAt: NOW - 30 * 60 * 1_000,
      lastResponseAt: NOW - 30 * 60 * 1_000
    })

    expect(
      filterActivityLaneCards([parent, child], {
        now: NOW,
        recentMinutes: 1_440,
        status: 'all',
        showOlder: false
      }).map((item) => item.paneKey)
    ).toEqual(['old-parent', 'recent-child'])
  })

  it('extends active sessions to Now and stops completed sessions at their finish', () => {
    const active = activityTimelineBounds(card(), NOW, 120)
    const done = activityTimelineBounds(
      card({
        bucket: 'done',
        dotState: 'done',
        startedAt: NOW - 90 * 60 * 1_000,
        finishedAt: NOW - 30 * 60 * 1_000
      }),
      NOW,
      120
    )

    expect(active.endPercent).toBe(100)
    expect(done.startPercent).toBe(25)
    expect(done.endPercent).toBe(75)
  })
})
