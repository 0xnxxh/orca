import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkedTerminalByteWatcherOptions } from './parked-terminal-byte-watcher'

const WORKTREE_ID = 'repo::/worktree'
const TAB_ID = 'tab-1'
const PTY_ID = 'ssh:connection-1@@pty-1'
const SECOND_PTY_ID = 'ssh:connection-1@@pty-2'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_LEAF_ID = '22222222-2222-4222-8222-222222222222'

type StartedWatcher = {
  options: ParkedTerminalByteWatcherOptions
  activateParked: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

type ExitSubscription = {
  ptyId: string
  callback: (code: number, context: { hadPrimary: boolean }) => void
}

const {
  closeTerminalTab,
  activationFailurePtyIds,
  exitSubscriptionFailurePtyIds,
  exitSubscriptions,
  mockStoreState,
  startedWatchers,
  watcherStartFailurePtyIds
} = vi.hoisted(() => ({
  closeTerminalTab: vi.fn(),
  activationFailurePtyIds: new Set<string>(),
  exitSubscriptionFailurePtyIds: new Set<string>(),
  exitSubscriptions: [] as ExitSubscription[],
  mockStoreState: {
    tabsByWorktree: {},
    terminalLayoutsByTabId: {},
    runtimePaneTitlesByTabId: {},
    settings: null,
    runtimeStatusByEnvironmentId: new Map(),
    clearTabLaunchAgent: vi.fn(),
    clearRuntimePaneTitle: vi.fn(),
    setTabLayout: vi.fn(),
    updateTabTitle: vi.fn()
  },
  startedWatchers: [] as StartedWatcher[],
  watcherStartFailurePtyIds: new Set<string>()
}))

vi.mock('./parked-terminal-byte-watcher', () => ({
  startParkedTerminalByteWatcher: (options: ParkedTerminalByteWatcherOptions) => {
    if (watcherStartFailurePtyIds.has(options.ptyId)) {
      throw new Error('watcher start failed')
    }
    const watcher = {
      options,
      activateParked: vi.fn(() => !activationFailurePtyIds.has(options.ptyId)),
      dispose: vi.fn()
    }
    startedWatchers.push(watcher)
    return watcher
  }
}))

vi.mock('./pty-dispatcher', () => ({
  subscribeToPtyExit: (
    ptyId: string,
    callback: (code: number, context: { hadPrimary: boolean }) => void
  ) => {
    if (exitSubscriptionFailurePtyIds.has(ptyId)) {
      throw new Error('exit subscription failed')
    }
    exitSubscriptions.push({ ptyId, callback })
    return vi.fn()
  }
}))

vi.mock('../terminal/terminal-tab-actions', () => ({ closeTerminalTab }))

vi.mock('@/store', () => ({ useAppStore: { getState: () => mockStoreState } }))

import {
  activatePreparedParkedTerminalTabWatchers,
  getParkedTerminalWatcherTabIds,
  pruneParkedTerminalWatchers,
  registerMountedTerminalPaneCandidateReader,
  syncParkedTerminalTabWatchers
} from './terminal-parked-tab-watchers'
import {
  beginParkedTerminalWatcherReplacement,
  type ParkedTerminalPaneCapture
} from './terminal-parked-watcher-registry'

const panes: ParkedTerminalPaneCapture[] = [
  { ptyId: PTY_ID, paneId: 1, leafId: LEAF_ID, drivesTabTitle: true },
  { ptyId: SECOND_PTY_ID, paneId: 2, leafId: SECOND_LEAF_ID, drivesTabTitle: false }
]
const tabs = [{ id: TAB_ID, ptyId: PTY_ID }]
let disposeMountedReader: (() => void) | null = null

function registerMountedReader(
  mountedPanes: typeof panes = panes
): ReturnType<typeof registerMountedTerminalPaneCandidateReader> {
  disposeMountedReader?.()
  disposeMountedReader = registerMountedTerminalPaneCandidateReader(
    TAB_ID,
    WORKTREE_ID,
    () => mountedPanes
  )
  return disposeMountedReader
}

function prepare(mountedPanes: typeof panes = panes): Set<string> {
  registerMountedReader(mountedPanes)
  return syncParkedTerminalTabWatchers({
    worktreeId: WORKTREE_ID,
    tabs,
    parkedTabIds: new Set(),
    desiredParkedTabIds: new Set([TAB_ID])
  })
}

describe('parked terminal watcher handoff', () => {
  const originalWindow = (globalThis as { window?: unknown }).window
  const administrativeWrite = vi.fn()

  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      api: { pty: { write: vi.fn(), administrativeWrite } }
    }
  })

  afterEach(() => {
    disposeMountedReader?.()
    disposeMountedReader = null
    pruneParkedTerminalWatchers(new Set())
    startedWatchers.length = 0
    exitSubscriptions.length = 0
    watcherStartFailurePtyIds.clear()
    activationFailurePtyIds.clear()
    exitSubscriptionFailurePtyIds.clear()
    vi.clearAllMocks()
    ;(globalThis as { window?: unknown }).window = originalWindow
  })

  it('prepares every split watcher before activating the parked phase', () => {
    expect(prepare()).toEqual(new Set([TAB_ID]))
    expect(startedWatchers).toHaveLength(2)
    expect(
      startedWatchers.every(({ activateParked }) => activateParked.mock.calls.length === 0)
    ).toBe(true)

    activatePreparedParkedTerminalTabWatchers({
      worktreeId: WORKTREE_ID,
      tabs,
      parkedTabIds: new Set([TAB_ID])
    })
    expect(
      startedWatchers.every(({ activateParked }) => activateParked.mock.calls.length === 1)
    ).toBe(true)
  })

  it('leaves split-exit policy to the mounted primary during preparation', () => {
    prepare()
    exitSubscriptions
      .find(({ ptyId }) => ptyId === SECOND_PTY_ID)
      ?.callback(0, { hadPrimary: true })

    expect(startedWatchers[1].dispose).toHaveBeenCalledOnce()
    expect(mockStoreState.setTabLayout).not.toHaveBeenCalled()
    expect(closeTerminalTab).not.toHaveBeenCalled()
  })

  it('rolls back every partial watcher when split preparation fails', () => {
    watcherStartFailurePtyIds.add(SECOND_PTY_ID)

    expect(prepare()).toEqual(new Set())
    expect(startedWatchers[0].dispose).toHaveBeenCalledOnce()
    expect(getParkedTerminalWatcherTabIds()).toEqual([])
  })

  it('disposes a constructed byte watcher when exit subscription fails', () => {
    exitSubscriptionFailurePtyIds.add(SECOND_PTY_ID)

    expect(prepare()).toEqual(new Set())
    expect(startedWatchers).toHaveLength(2)
    expect(startedWatchers[0].dispose).toHaveBeenCalledOnce()
    expect(startedWatchers[1].dispose).toHaveBeenCalledOnce()
    expect(getParkedTerminalWatcherTabIds()).toEqual([])
  })

  it('rolls back every split leaf when one activation fails', () => {
    expect(prepare()).toEqual(new Set([TAB_ID]))
    activationFailurePtyIds.add(SECOND_PTY_ID)

    expect(
      activatePreparedParkedTerminalTabWatchers({
        worktreeId: WORKTREE_ID,
        tabs,
        parkedTabIds: new Set([TAB_ID])
      })
    ).toEqual(new Set([TAB_ID]))
    expect(startedWatchers[0].activateParked).toHaveBeenCalledOnce()
    expect(startedWatchers[0].dispose).toHaveBeenCalledOnce()
    expect(startedWatchers[1].dispose).toHaveBeenCalledOnce()
    expect(getParkedTerminalWatcherTabIds()).toEqual([])
  })

  it('keeps the active parked entry when its replacement cannot fully prepare', () => {
    prepare()
    activatePreparedParkedTerminalTabWatchers({
      worktreeId: WORKTREE_ID,
      tabs,
      parkedTabIds: new Set([TAB_ID])
    })
    watcherStartFailurePtyIds.add(SECOND_PTY_ID)
    registerMountedReader([
      { ...panes[0], paneId: 3 },
      { ...panes[1], paneId: 4 }
    ])

    expect(
      syncParkedTerminalTabWatchers({
        worktreeId: WORKTREE_ID,
        tabs,
        parkedTabIds: new Set([TAB_ID]),
        desiredParkedTabIds: new Set([TAB_ID])
      })
    ).toEqual(new Set())

    expect(startedWatchers[0].dispose).not.toHaveBeenCalled()
    expect(startedWatchers[1].dispose).not.toHaveBeenCalled()
    expect(startedWatchers[2].dispose).toHaveBeenCalledOnce()
    expect(getParkedTerminalWatcherTabIds()).toEqual([TAB_ID])
  })

  it('fences a parked reply to the captured incarnation when the PTY id is reused', () => {
    prepare([
      {
        ...panes[0],
        mutationIdentity: {
          incarnationId: 'incarnation-before-reuse',
          paneGeneration: 7,
          mutationLeaseId: 'lease-before-reuse'
        },
        sideEffectIdentity: {
          incarnationId: 'incarnation-before-reuse',
          paneGeneration: 7
        }
      }
    ])

    startedWatchers[0].options.sendInput('\x1b[?997;1n')

    expect(administrativeWrite).toHaveBeenCalledWith(PTY_ID, '\x1b[?997;1n', {
      mode: 'exact',
      evidence: { incarnationId: 'incarnation-before-reuse', paneGeneration: 7 }
    })
    expect(window.api.pty.write).not.toHaveBeenCalled()
    expect(startedWatchers[0].options.sideEffectIdentity).toEqual({
      incarnationId: 'incarnation-before-reuse',
      paneGeneration: 7
    })
  })

  it('preserves a runtime-title slot already owned by the revealed successor', () => {
    prepare()
    activatePreparedParkedTerminalTabWatchers({
      worktreeId: WORKTREE_ID,
      tabs,
      parkedTabIds: new Set([TAB_ID])
    })
    registerMountedReader()

    syncParkedTerminalTabWatchers({
      worktreeId: WORKTREE_ID,
      tabs,
      parkedTabIds: new Set(),
      desiredParkedTabIds: new Set()
    })

    expect(startedWatchers[0].dispose).toHaveBeenCalledWith({ preserveRuntimeTitle: true })
    expect(mockStoreState.clearRuntimePaneTitle).not.toHaveBeenCalledWith(TAB_ID, 1)
  })

  it('keeps the parked owner live until the revealed successor commits', () => {
    prepare()
    activatePreparedParkedTerminalTabWatchers({
      worktreeId: WORKTREE_ID,
      tabs,
      parkedTabIds: new Set([TAB_ID])
    })
    const replacement = beginParkedTerminalWatcherReplacement(TAB_ID, PTY_ID)
    expect(replacement).not.toBeNull()

    syncParkedTerminalTabWatchers({
      worktreeId: WORKTREE_ID,
      tabs,
      parkedTabIds: new Set(),
      desiredParkedTabIds: new Set()
    })

    expect(startedWatchers[0].dispose).not.toHaveBeenCalled()
    expect(startedWatchers[1].dispose).toHaveBeenCalledOnce()
    const installSuccessor = vi.fn(() => true)
    expect(replacement?.commit(installSuccessor)).toBe(true)
    expect(installSuccessor).toHaveBeenCalledOnce()
    expect(startedWatchers[0].dispose).toHaveBeenCalledWith({ preserveRuntimeTitle: true })
    expect(getParkedTerminalWatcherTabIds()).toEqual([])
  })

  it('leaves the predecessor reachable when replacement aborts or is superseded', () => {
    prepare()
    activatePreparedParkedTerminalTabWatchers({
      worktreeId: WORKTREE_ID,
      tabs,
      parkedTabIds: new Set([TAB_ID])
    })
    const stale = beginParkedTerminalWatcherReplacement(TAB_ID, PTY_ID)
    const current = beginParkedTerminalWatcherReplacement(TAB_ID, PTY_ID)

    expect(stale?.commit(() => true)).toBe(false)
    current?.abort()
    syncParkedTerminalTabWatchers({
      worktreeId: WORKTREE_ID,
      tabs,
      parkedTabIds: new Set(),
      desiredParkedTabIds: new Set()
    })

    expect(startedWatchers[0].dispose).not.toHaveBeenCalled()
    expect(getParkedTerminalWatcherTabIds()).toEqual([TAB_ID])
  })
})
