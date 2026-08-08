import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type {
  ParkedTabWatcherEntry,
  ParkedTerminalPaneCapture
} from './terminal-parked-watcher-registry'

const WORKTREE_ID = 'repo::/worktree'
const TAB_ID = 'tab-1'
const FIRST_PTY_ID = `${WORKTREE_ID}@@session-1`
const OLD_SECOND_PTY_ID = `${WORKTREE_ID}@@session-2`
const NEW_SECOND_PTY_ID = `${WORKTREE_ID}@@session-3`
const FIRST_LEAF_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_LEAF_ID = '22222222-2222-4222-8222-222222222222'

const startedWatchers: {
  pane: ParkedTerminalPaneCapture
  dispose: ReturnType<typeof vi.fn>
}[] = []

vi.mock('./terminal-parked-pty-watcher', () => ({
  collapseParkedExitedLeaf: vi.fn(),
  startParkedPtyWatcher: (args: {
    pane: ParkedTerminalPaneCapture
    entry: ParkedTabWatcherEntry
  }) => {
    if (!args.pane.ptyId) {
      return
    }
    const dispose = vi.fn()
    startedWatchers.push({ pane: args.pane, dispose })
    args.entry.paneIdByPtyId.set(args.pane.ptyId, args.pane.paneId)
    args.entry.paneCaptureByPtyId?.set(args.pane.ptyId, args.pane)
    args.entry.activateByPtyId?.set(
      args.pane.ptyId,
      vi.fn(() => true)
    )
    args.entry.disposersByPtyId.set(args.pane.ptyId, dispose)
    return true
  }
}))

vi.mock('./pty-pre-handler-buffer', () => ({
  discardPreHandlerPtyState: vi.fn()
}))

vi.mock('../terminal/terminal-provider-snapshot-capability', () => ({
  terminalProviderHasAuthoritativeSnapshot: () => true
}))

const state = {
  tabsByWorktree: {},
  terminalLayoutsByTabId: {} as Record<string, object>,
  runtimePaneTitlesByTabId: {} as Record<string, Record<number, string>>,
  settings: null,
  runtimeStatusByEnvironmentId: new Map(),
  clearRuntimePaneTitle: vi.fn(),
  setRuntimePaneTitle: vi.fn()
}

vi.mock('@/store', () => ({
  useAppStore: { getState: () => state }
}))

import {
  activatePreparedParkedTerminalTabWatchers,
  captureParkedTerminalPaneCandidates,
  pruneParkedTerminalWatchers,
  registerMountedTerminalPaneCandidateReader,
  syncParkedTerminalTabWatchers
} from './terminal-parked-tab-watchers'

function sync(): void {
  syncParkedTerminalTabWatchers({
    worktreeId: WORKTREE_ID,
    tabs: [{ id: TAB_ID, ptyId: FIRST_PTY_ID }],
    parkedTabIds: new Set([TAB_ID])
  })
}

beforeEach(() => {
  state.terminalLayoutsByTabId = {}
  state.runtimePaneTitlesByTabId = { [TAB_ID]: { 1: '⠋ Continuing agent', 2: 'Retired shell' } }
  startedWatchers.length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  pruneParkedTerminalWatchers(new Set())
})

it('replaces the exact watcher set while preserving a continuing pane title', () => {
  const mountedPanes = [
    { ptyId: FIRST_PTY_ID, paneId: 1, leafId: FIRST_LEAF_ID, drivesTabTitle: true },
    { ptyId: OLD_SECOND_PTY_ID, paneId: 2, leafId: SECOND_LEAF_ID, drivesTabTitle: false }
  ]
  captureParkedTerminalPaneCandidates(TAB_ID, WORKTREE_ID, mountedPanes)
  const unregisterReader = registerMountedTerminalPaneCandidateReader(
    TAB_ID,
    WORKTREE_ID,
    () => mountedPanes
  )
  sync()
  activatePreparedParkedTerminalTabWatchers({
    worktreeId: WORKTREE_ID,
    tabs: [{ id: TAB_ID, ptyId: FIRST_PTY_ID }],
    parkedTabIds: new Set([TAB_ID])
  })
  unregisterReader()

  state.terminalLayoutsByTabId[TAB_ID] = {
    root: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: FIRST_LEAF_ID },
      second: { type: 'leaf', leafId: SECOND_LEAF_ID }
    },
    activeLeafId: FIRST_LEAF_ID,
    expandedLeafId: null,
    ptyIdsByLeafId: {
      [FIRST_LEAF_ID]: FIRST_PTY_ID,
      [SECOND_LEAF_ID]: NEW_SECOND_PTY_ID
    }
  }
  const unregisterReplacementReader = registerMountedTerminalPaneCandidateReader(
    TAB_ID,
    WORKTREE_ID,
    () => [
      { ptyId: FIRST_PTY_ID, paneId: 1, leafId: FIRST_LEAF_ID, drivesTabTitle: true },
      { ptyId: NEW_SECOND_PTY_ID, paneId: 2, leafId: SECOND_LEAF_ID, drivesTabTitle: false }
    ]
  )
  sync()
  unregisterReplacementReader()

  expect(startedWatchers[0].dispose).toHaveBeenCalledOnce()
  expect(startedWatchers[1].dispose).toHaveBeenCalledOnce()
  expect(startedWatchers[3].pane).toMatchObject({
    ptyId: NEW_SECOND_PTY_ID,
    paneId: 2,
    drivesTabTitle: false
  })
  expect(state.clearRuntimePaneTitle).toHaveBeenCalledWith(TAB_ID, 2)
  expect(state.clearRuntimePaneTitle).not.toHaveBeenCalledWith(TAB_ID, 1)
})
