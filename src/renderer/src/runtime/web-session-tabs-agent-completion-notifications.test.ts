import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import { makePaneKey } from '../../../shared/stable-pane-id'
import { toWebTerminalSurfaceTabId } from '../../../shared/terminal-surface-id'

const mocks = vi.hoisted(() => ({
  observeAgentHookCompletionForNotification: vi.fn()
}))

vi.mock('@/hooks/agent-hook-completion-notifications', () => ({
  observeAgentHookCompletionForNotification: mocks.observeAgentHookCompletionForNotification
}))

import { useAppStore } from '@/store'
import {
  applyWebSessionTabsSnapshot,
  applyWebSessionTabsStorePatch,
  resetWebSessionTabsSnapshotFreshnessForTests
} from './web-session-tabs-sync'

const ENVIRONMENT_ID = 'web-env-1'
const WORKTREE_ID = 'repo::/worktree'
const HOST_TAB_ID = 'host-tab-1'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const NOW = 1_700_000_000_000
const initialState = useAppStore.getInitialState()

function makeAgentSnapshot(
  snapshotVersion: number,
  updatedAt: number,
  turnCompletedAt?: number
): RuntimeMobileSessionTabsResult {
  return {
    worktree: WORKTREE_ID,
    publicationEpoch: 'epoch-1',
    snapshotVersion,
    activeGroupId: 'host-group-1',
    activeTabId: HOST_TAB_ID,
    activeTabType: 'terminal',
    tabs: [
      {
        type: 'terminal',
        id: `${HOST_TAB_ID}::${LEAF_ID}`,
        title: 'Claude working',
        parentTabId: HOST_TAB_ID,
        leafId: LEAF_ID,
        isActive: true,
        status: 'ready',
        terminal: 'terminal-1',
        ...(turnCompletedAt !== undefined ? { turnCompletedAt } : {}),
        agentStatus: {
          state: 'working',
          prompt: 'review the PR',
          updatedAt,
          stateStartedAt: NOW,
          agentType: 'claude',
          paneKey: makePaneKey(HOST_TAB_ID, LEAF_ID),
          tabId: HOST_TAB_ID,
          worktreeId: WORKTREE_ID,
          stateHistory: []
        }
      }
    ]
  }
}

function applySnapshot(snapshot: RuntimeMobileSessionTabsResult, live: boolean): void {
  applyWebSessionTabsStorePatch(
    (state) => applyWebSessionTabsSnapshot(state, snapshot, ENVIRONMENT_ID, NOW),
    live ? snapshot : undefined
  )
}

describe('paired session-tab agent completion notifications', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.observeAgentHookCompletionForNotification.mockReset()
    resetWebSessionTabsSnapshotFreshnessForTests()
    useAppStore.setState(initialState, true)
  })

  afterEach(() => {
    useAppStore.setState(initialState, true)
    resetWebSessionTabsSnapshotFreshnessForTests()
    vi.useRealTimers()
  })

  it('forwards accepted live status and excludes snapshot or reconnect replays', () => {
    applySnapshot(makeAgentSnapshot(1, NOW), false)
    expect(mocks.observeAgentHookCompletionForNotification).not.toHaveBeenCalled()

    applySnapshot(makeAgentSnapshot(2, NOW + 1_000), true)
    expect(mocks.observeAgentHookCompletionForNotification).toHaveBeenCalledTimes(1)

    const turnCompletedAt = NOW + 2_000
    applySnapshot(makeAgentSnapshot(3, NOW + 2_000, turnCompletedAt), true)
    expect(mocks.observeAgentHookCompletionForNotification).toHaveBeenLastCalledWith({
      paneKey: makePaneKey(toWebTerminalSurfaceTabId(HOST_TAB_ID), LEAF_ID),
      worktreeId: WORKTREE_ID,
      payload: expect.objectContaining({
        state: 'working',
        stateStartedAt: NOW,
        turnCompletedAt
      })
    })

    applySnapshot(makeAgentSnapshot(4, NOW + 3_000, turnCompletedAt + 1_000), false)
    expect(mocks.observeAgentHookCompletionForNotification).toHaveBeenCalledTimes(2)
  })
})
