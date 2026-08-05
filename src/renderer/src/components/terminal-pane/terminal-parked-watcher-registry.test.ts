import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bufferPreHandlerPtyData,
  bufferPreHandlerPtyExit,
  clearPreHandlerPtyState,
  drainPreHandlerPtyData,
  drainPreHandlerPtyExit,
  hasPreHandlerPtyExit
} from './pty-pre-handler-buffer'
import {
  capturedPanesByTabId,
  consumeParkedTerminalViewportFrames,
  parkedWatchersByTabId,
  pruneParkedTerminalWatchers,
  terminalWatcherLiveWorkspaceIds
} from './terminal-parked-watcher-registry'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'

const TAB_ID = 'removed-parked-tab'
const PTY_ID = 'removed-worktree@@parked-pty'
const FLOATING_TAB_ID = 'floating-parked-tab'
const FLOATING_PTY_ID = `${FLOATING_TERMINAL_WORKTREE_ID}@@parked-pty`

describe('terminal parked watcher registry removal', () => {
  afterEach(() => {
    parkedWatchersByTabId.delete(TAB_ID)
    parkedWatchersByTabId.delete(FLOATING_TAB_ID)
    capturedPanesByTabId.delete(TAB_ID)
    capturedPanesByTabId.delete(FLOATING_TAB_ID)
    clearPreHandlerPtyState(PTY_ID)
  })

  it('consumes retained state and suppresses a delayed exit for a removed worktree', () => {
    const dispose = vi.fn()
    parkedWatchersByTabId.set(TAB_ID, {
      worktreeId: 'removed-worktree',
      tabPtyId: PTY_ID,
      paneIdByPtyId: new Map([[PTY_ID, 1]]),
      disposersByPtyId: new Map([[PTY_ID, dispose]])
    })
    bufferPreHandlerPtyData(PTY_ID, 'final frame')
    bufferPreHandlerPtyExit(PTY_ID, 17)

    pruneParkedTerminalWatchers(new Set())

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(parkedWatchersByTabId.has(TAB_ID)).toBe(false)
    expect(hasPreHandlerPtyExit(PTY_ID)).toBe(false)
    const data = vi.fn()
    drainPreHandlerPtyData(PTY_ID, data)
    expect(data).not.toHaveBeenCalled()

    // Why: the actual kill exit can arrive after sidecar disposal and prune.
    bufferPreHandlerPtyExit(PTY_ID, 18)
    bufferPreHandlerPtyData(PTY_ID, 'delayed final frame')
    const exit = vi.fn()
    const delayedData = vi.fn()
    drainPreHandlerPtyExit(PTY_ID, exit)
    drainPreHandlerPtyData(PTY_ID, delayedData)
    expect(exit).not.toHaveBeenCalled()
    expect(delayedData).not.toHaveBeenCalled()
  })

  it('keeps the floating workspace while pruning a removed workspace', () => {
    const removedDispose = vi.fn()
    const floatingDispose = vi.fn()
    parkedWatchersByTabId.set(TAB_ID, {
      worktreeId: 'removed-worktree',
      tabPtyId: PTY_ID,
      paneIdByPtyId: new Map([[PTY_ID, 1]]),
      disposersByPtyId: new Map([[PTY_ID, removedDispose]])
    })
    parkedWatchersByTabId.set(FLOATING_TAB_ID, {
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      tabPtyId: FLOATING_PTY_ID,
      paneIdByPtyId: new Map([[FLOATING_PTY_ID, 1]]),
      disposersByPtyId: new Map([[FLOATING_PTY_ID, floatingDispose]])
    })
    capturedPanesByTabId.set(TAB_ID, { worktreeId: 'removed-worktree', panes: [] })
    capturedPanesByTabId.set(FLOATING_TAB_ID, {
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      panes: []
    })

    pruneParkedTerminalWatchers(terminalWatcherLiveWorkspaceIds([]))

    expect(parkedWatchersByTabId.has(TAB_ID)).toBe(false)
    expect(capturedPanesByTabId.has(TAB_ID)).toBe(false)
    expect(removedDispose).toHaveBeenCalledOnce()
    expect(parkedWatchersByTabId.has(FLOATING_TAB_ID)).toBe(true)
    expect(capturedPanesByTabId.has(FLOATING_TAB_ID)).toBe(true)
    expect(floatingDispose).not.toHaveBeenCalled()
  })

  it('consumes a matching parked viewport frame exactly once', () => {
    const frame = { data: 'cached viewport', cols: 120, rows: 40 }
    capturedPanesByTabId.set(TAB_ID, {
      worktreeId: 'removed-worktree',
      panes: [
        {
          ptyId: PTY_ID,
          paneId: 1,
          leafId: 'leaf-1',
          drivesTabTitle: true,
          viewportFrame: frame
        }
      ]
    })
    parkedWatchersByTabId.set(TAB_ID, {
      worktreeId: 'removed-worktree',
      tabPtyId: PTY_ID,
      paneIdByPtyId: new Map([[PTY_ID, 1]]),
      disposersByPtyId: new Map([[PTY_ID, vi.fn()]])
    })

    expect(consumeParkedTerminalViewportFrames(TAB_ID, { 'leaf-1': PTY_ID }, null)).toEqual([
      { leafId: 'leaf-1', frame }
    ])
    expect(consumeParkedTerminalViewportFrames(TAB_ID, { 'leaf-1': PTY_ID }, null)).toEqual([])
    expect(capturedPanesByTabId.get(TAB_ID)?.panes[0]).not.toHaveProperty('viewportFrame')
  })

  it('drops a cached viewport when the parked PTY identity changed', () => {
    capturedPanesByTabId.set(TAB_ID, {
      worktreeId: 'removed-worktree',
      panes: [
        {
          ptyId: PTY_ID,
          paneId: 1,
          leafId: 'leaf-1',
          drivesTabTitle: true,
          viewportFrame: { data: 'stale viewport', cols: 80, rows: 24 }
        }
      ]
    })
    parkedWatchersByTabId.set(TAB_ID, {
      worktreeId: 'removed-worktree',
      tabPtyId: 'replacement-pty',
      paneIdByPtyId: new Map([['replacement-pty', 1]]),
      disposersByPtyId: new Map([['replacement-pty', vi.fn()]])
    })

    expect(
      consumeParkedTerminalViewportFrames(TAB_ID, { 'leaf-1': 'replacement-pty' }, null)
    ).toEqual([])
    expect(capturedPanesByTabId.get(TAB_ID)?.panes[0]).not.toHaveProperty('viewportFrame')
  })
})
