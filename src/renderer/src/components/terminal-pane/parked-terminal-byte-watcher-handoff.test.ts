import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkedTerminalByteWatcherOptions } from './parked-terminal-byte-watcher'

const PTY_ID = 'pty-parked-handoff'
const TAB_ID = 'tab-parked-handoff'
const WORKTREE_ID = 'repo-1::/tmp/wt-1'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PANE_ID = 1
const IDLE_TITLE = '✳ Build feature'

const commandStatusPolicy = {
  onCommandFinished: vi.fn(),
  onCommandCodeWorking: vi.fn(),
  onCommandCodeDone: vi.fn(),
  dispose: vi.fn()
}

vi.mock('./parked-terminal-command-status', () => ({
  createParkedTerminalCommandStatusPolicy: vi.fn(() => commandStatusPolicy),
  readInFlightCommandCodeTurn: vi.fn(() => null)
}))
vi.mock('@/lib/terminal-theme', () => ({ getSystemPrefersDark: () => true }))
vi.mock('./use-notification-dispatch', () => ({ dispatchTerminalNotification: vi.fn() }))

const storeState = {
  settings: {
    terminalMainSideEffectAuthority: false,
    terminalHiddenDeliveryGate: true,
    promptCacheTimerEnabled: true,
    notifications: { enabled: true, agentTaskComplete: true }
  },
  setRuntimePaneTitle: vi.fn(),
  clearRuntimePaneTitle: vi.fn(),
  updateTabTitle: vi.fn(),
  markWorktreeUnread: vi.fn(),
  markTerminalTabUnread: vi.fn(),
  markTerminalPaneUnread: vi.fn(),
  setCacheTimerStartedAt: vi.fn(),
  observeTerminalGitHubPullRequestLink: vi.fn(),
  agentStatusByPaneKey: {}
}

vi.mock('@/store', () => ({
  useAppStore: { getState: () => storeState }
}))

describe('parked terminal byte watcher handoff', () => {
  const originalWindow = (globalThis as { window?: typeof window }).window
  let onData: ((payload: { id: string; data: string }) => void) | null

  async function startWatcher(
    overrides: Partial<ParkedTerminalByteWatcherOptions> = {},
    activate = true
  ) {
    const { startParkedTerminalByteWatcher } = await import('./parked-terminal-byte-watcher')
    const watcher = startParkedTerminalByteWatcher({
      ptyId: PTY_ID,
      tabId: TAB_ID,
      worktreeId: WORKTREE_ID,
      leafId: LEAF_ID,
      paneId: PANE_ID,
      sendInput: vi.fn(),
      ...overrides
    })
    if (activate) {
      watcher.activateParked()
    }
    return watcher
  }

  function emitAndFlush(data: string): void {
    onData?.({ id: PTY_ID, data })
    vi.advanceTimersByTime(0)
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    storeState.settings.terminalMainSideEffectAuthority = false
    storeState.settings.terminalHiddenDeliveryGate = true
    onData = null
    ;(globalThis as { window: typeof window }).window = {
      ...originalWindow,
      api: {
        pty: {
          onData: vi.fn((callback: (payload: { id: string; data: string }) => void) => {
            onData = callback
            return () => {}
          }),
          onReplay: vi.fn(() => () => {}),
          onExit: vi.fn(() => () => {}),
          ackData: vi.fn()
        }
      }
    } as unknown as typeof window
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalWindow) {
      ;(globalThis as { window: typeof window }).window = originalWindow
    } else {
      delete (globalThis as { window?: typeof window }).window
    }
  })

  it('releases constructed policy state when byte subscription setup throws', async () => {
    ;(window as unknown as { api: { pty: { onData: () => never } } }).api.pty.onData = vi.fn(() => {
      throw new Error('byte subscription failed')
    })

    await expect(startWatcher({}, false)).rejects.toThrow('byte subscription failed')
    expect(commandStatusPolicy.dispose).toHaveBeenCalledOnce()
  })

  it('does not parse raw sidecar bytes while the mounted primary exists', async () => {
    const watcher = await startWatcher()
    const { ptyDataHandlers } = await import('./pty-dispatcher')
    const primaryHandler = vi.fn()
    const workingTitleOsc = '\x1b]0;⠋ Build feature\x07'
    ptyDataHandlers.set(PTY_ID, primaryHandler)

    emitAndFlush(workingTitleOsc)
    expect(primaryHandler).toHaveBeenCalledWith(workingTitleOsc, undefined)
    expect(storeState.setRuntimePaneTitle).not.toHaveBeenCalled()

    ptyDataHandlers.delete(PTY_ID)
    emitAndFlush(`\x1b]0;${IDLE_TITLE}\x07`)
    expect(storeState.setRuntimePaneTitle).toHaveBeenCalledWith(TAB_ID, PANE_ID, IDLE_TITLE)
    watcher.dispose()
  })

  it('drops the bare cursor-agent native title before it reaches the store', async () => {
    const watcher = await startWatcher()
    emitAndFlush('\x1b]0;Cursor Agent\x07')
    expect(storeState.setRuntimePaneTitle).not.toHaveBeenCalled()
    expect(storeState.updateTabTitle).not.toHaveBeenCalled()
    watcher.dispose()
  })

  it('does not drive the tab title when drivesTabTitle is false', async () => {
    const watcher = await startWatcher({ drivesTabTitle: false })
    emitAndFlush(`\x1b]0;${IDLE_TITLE}\x07`)
    expect(storeState.setRuntimePaneTitle).toHaveBeenCalledWith(TAB_ID, PANE_ID, IDLE_TITLE)
    expect(storeState.updateTabTitle).not.toHaveBeenCalled()
    watcher.dispose()
  })

  it('activates hidden delivery only after preparation and clears it on dispose', async () => {
    storeState.settings.terminalMainSideEffectAuthority = true
    const setHiddenRendererPty = vi.fn()
    ;(window as unknown as { api: { pty: Record<string, unknown> } }).api.pty.setHiddenRendererPty =
      setHiddenRendererPty
    const watcher = await startWatcher({}, false)

    expect(setHiddenRendererPty).not.toHaveBeenCalled()
    expect(watcher.activateParked()).toBe(true)
    expect(setHiddenRendererPty).toHaveBeenCalledWith(PTY_ID, true)

    watcher.dispose()
    expect(setHiddenRendererPty).toHaveBeenLastCalledWith(PTY_ID, false)
  })
})
