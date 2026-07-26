import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import {
  notifyCodexPaneBoundForStaleSweep,
  resetCodexStalePaneSweepForTests
} from './codex-stale-pane-sweep'

const ACCOUNT_A = 'account-a@example.com'
const ACCOUNT_B = 'account-b@example.com'

const STALE_PANE = {
  ptyId: 'pty-1',
  launchAccountId: 'account-a',
  activeAccountId: 'account-b'
}

describe('notifyCodexPaneBoundForStaleSweep', () => {
  const originalWindow = (globalThis as { window?: typeof window }).window

  beforeEach(() => {
    vi.useFakeTimers()
    resetCodexStalePaneSweepForTests()
    useAppStore.setState({
      tabsByWorktree: {
        wt1: [
          {
            id: 'tab-1',
            ptyId: 'pty-1',
            worktreeId: 'wt1',
            title: 'orca-1',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1,
            launchAgent: 'codex'
          }
        ]
      },
      ptyIdsByTabId: { 'tab-1': ['pty-1'] },
      pendingCodexPaneRestartIds: {},
      codexRestartNoticeByPtyId: {}
    })
    ;(globalThis as { window: typeof window }).window = {
      ...originalWindow,
      api: {
        ...originalWindow?.api,
        pty: {
          ...originalWindow?.api?.pty,
          inspectProcess: vi
            .fn()
            .mockResolvedValue({ foregroundProcess: 'codex', hasChildProcesses: false })
        },
        codexAccounts: {
          ...originalWindow?.api?.codexAccounts,
          list: vi.fn().mockResolvedValue({
            accounts: [
              { id: 'account-a', email: ACCOUNT_A },
              { id: 'account-b', email: ACCOUNT_B }
            ],
            activeAccountId: 'account-b'
          }),
          listStalePanes: vi.fn().mockResolvedValue([])
        }
      }
    } as unknown as typeof window
  })

  afterEach(() => {
    resetCodexStalePaneSweepForTests()
    vi.useRealTimers()
    if (originalWindow) {
      ;(globalThis as { window: typeof window }).window = originalWindow
    } else {
      delete (globalThis as { window?: typeof window }).window
    }
  })

  it('raises the prompt once the pane PTY actually binds', async () => {
    vi.mocked(window.api.codexAccounts.listStalePanes).mockResolvedValue([STALE_PANE])

    notifyCodexPaneBoundForStaleSweep('pty-1')
    // Nothing inspected yet: the bind has not settled.
    expect(window.api.pty.inspectProcess).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)

    expect(window.api.codexAccounts.listStalePanes).toHaveBeenCalledWith({ ptyIds: ['pty-1'] })
    expect(useAppStore.getState().codexRestartNoticeByPtyId['pty-1']).toEqual({
      previousAccountLabel: ACCOUNT_A,
      nextAccountLabel: ACCOUNT_B
    })
  })

  it('coalesces a burst of startup binds into one sweep', async () => {
    useAppStore.setState({ ptyIdsByTabId: { 'tab-1': ['pty-1', 'pty-2'] } })
    vi.mocked(window.api.codexAccounts.listStalePanes).mockResolvedValue([STALE_PANE])

    notifyCodexPaneBoundForStaleSweep('pty-1')
    notifyCodexPaneBoundForStaleSweep('pty-2')
    await vi.advanceTimersByTimeAsync(300)

    expect(window.api.codexAccounts.listStalePanes).toHaveBeenCalledExactlyOnceWith({
      ptyIds: ['pty-1', 'pty-2']
    })
  })

  it('retries a PTY whose process read is unusable until the reattach settles', async () => {
    vi.mocked(window.api.codexAccounts.listStalePanes).mockResolvedValue([STALE_PANE])
    vi.mocked(window.api.pty.inspectProcess).mockRejectedValueOnce(new Error('terminal_gone'))

    notifyCodexPaneBoundForStaleSweep('pty-1')
    await vi.advanceTimersByTimeAsync(300)
    expect(useAppStore.getState().codexRestartNoticeByPtyId).toEqual({})

    await vi.advanceTimersByTimeAsync(1500)

    expect(useAppStore.getState().codexRestartNoticeByPtyId['pty-1']).toEqual({
      previousAccountLabel: ACCOUNT_A,
      nextAccountLabel: ACCOUNT_B
    })
  })

  it('gives up after a bounded ladder instead of polling forever', async () => {
    vi.mocked(window.api.pty.inspectProcess).mockRejectedValue(new Error('terminal_gone'))

    notifyCodexPaneBoundForStaleSweep('pty-1')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(window.api.pty.inspectProcess).toHaveBeenCalledTimes(3)
  })

  it('stops retrying a pane the registry reports as not stale', async () => {
    notifyCodexPaneBoundForStaleSweep('pty-1')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(window.api.codexAccounts.listStalePanes).toHaveBeenCalledTimes(1)
  })

  it('does not re-prompt a pane that already got its notice', async () => {
    vi.mocked(window.api.codexAccounts.listStalePanes).mockResolvedValue([STALE_PANE])

    notifyCodexPaneBoundForStaleSweep('pty-1')
    await vi.advanceTimersByTimeAsync(300)
    notifyCodexPaneBoundForStaleSweep('pty-1')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(window.api.codexAccounts.listStalePanes).toHaveBeenCalledTimes(1)
  })

  it('never marks a plain shell pane, so its input is never blocked', async () => {
    useAppStore.setState({
      tabsByWorktree: {
        wt1: [
          {
            id: 'tab-1',
            ptyId: 'pty-1',
            worktreeId: 'wt1',
            title: 'orca-1',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1
          }
        ]
      }
    })
    vi.mocked(window.api.pty.inspectProcess).mockResolvedValue({
      foregroundProcess: 'zsh',
      hasChildProcesses: false
    })
    vi.mocked(window.api.codexAccounts.listStalePanes).mockResolvedValue([STALE_PANE])

    notifyCodexPaneBoundForStaleSweep('pty-1')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(window.api.codexAccounts.listStalePanes).not.toHaveBeenCalled()
    expect(useAppStore.getState().codexRestartNoticeByPtyId).toEqual({})
  })

  it('retries a Codex tab still showing its shell, then prompts when Codex is up', async () => {
    vi.mocked(window.api.codexAccounts.listStalePanes).mockResolvedValue([STALE_PANE])
    vi.mocked(window.api.pty.inspectProcess).mockResolvedValueOnce({
      foregroundProcess: 'pwsh.exe',
      hasChildProcesses: false
    })

    notifyCodexPaneBoundForStaleSweep('pty-1')
    await vi.advanceTimersByTimeAsync(300)
    expect(useAppStore.getState().codexRestartNoticeByPtyId).toEqual({})

    await vi.advanceTimersByTimeAsync(1500)

    expect(useAppStore.getState().codexRestartNoticeByPtyId['pty-1']).toEqual({
      previousAccountLabel: ACCOUNT_A,
      nextAccountLabel: ACCOUNT_B
    })
  })

  it('retries a PTY the store has not yet listed against its tab', async () => {
    useAppStore.setState({ ptyIdsByTabId: {} })
    vi.mocked(window.api.codexAccounts.listStalePanes).mockResolvedValue([STALE_PANE])

    notifyCodexPaneBoundForStaleSweep('pty-1')
    await vi.advanceTimersByTimeAsync(300)
    expect(window.api.pty.inspectProcess).not.toHaveBeenCalled()

    useAppStore.setState({ ptyIdsByTabId: { 'tab-1': ['pty-1'] } })
    await vi.advanceTimersByTimeAsync(1500)

    expect(useAppStore.getState().codexRestartNoticeByPtyId['pty-1']).toEqual({
      previousAccountLabel: ACCOUNT_A,
      nextAccountLabel: ACCOUNT_B
    })
  })
})
