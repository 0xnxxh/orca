import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WINDOWS_LEGACY_PTY_SHUTDOWN_BLOCK_REASON } from '../../../../shared/pty-shutdown-safety'

const mocks = vi.hoisted(() => {
  const state = {
    activeWorktreeId: null as string | null,
    setActiveWorktree: vi.fn(),
    shutdownWorktreeBrowsers: vi.fn().mockResolvedValue(undefined),
    shutdownWorktreeTerminals: vi.fn().mockResolvedValue(undefined),
    suppressPtyExit: vi.fn(),
    consumeSuppressedPtyExit: vi.fn(),
    tabsByWorktree: {} as Record<string, { id: string }[]>,
    unifiedTabsByWorktree: {},
    ptyIdsByTabId: {} as Record<string, string[]>,
    terminalLayoutsByTabId: {},
    lastKnownRelayPtyIdByTabId: {},
    deferredSshSessionIdsByTabId: {},
    pendingReconnectPtyIdByTabId: {}
  }
  const suspendWorkspace = vi.fn().mockResolvedValue(null)
  const toastError = vi.fn()
  const markWorktreeSleepIntent = vi.fn()
  const clearWorktreeSleepIntent = vi.fn()
  return {
    clearWorktreeSleepIntent,
    markWorktreeSleepIntent,
    state,
    suspendWorkspace,
    toastError
  }
})

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => mocks.state
  }
}))

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/lib/worktree-sleep-intent', () => ({
  clearWorktreeSleepIntent: mocks.clearWorktreeSleepIntent,
  markWorktreeSleepIntent: mocks.markWorktreeSleepIntent
}))

import { runSleepWorktree, runSleepWorktrees } from './sleep-worktree-flow'

describe('runSleepWorktree', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
    delete (globalThis as { __ORCA_WEB_CLIENT__?: boolean }).__ORCA_WEB_CLIENT__
    vi.stubGlobal('window', {
      api: {
        ephemeralVm: {
          suspendWorkspace: mocks.suspendWorkspace
        }
      },
      requestAnimationFrame: vi.fn()
    })
    mocks.state.setActiveWorktree.mockClear()
    mocks.state.shutdownWorktreeBrowsers.mockClear().mockResolvedValue(undefined)
    mocks.state.shutdownWorktreeTerminals.mockClear().mockResolvedValue(undefined)
    mocks.state.suppressPtyExit.mockClear()
    mocks.state.consumeSuppressedPtyExit.mockClear()
    mocks.suspendWorkspace.mockClear().mockResolvedValue(null)
    mocks.markWorktreeSleepIntent.mockClear()
    mocks.clearWorktreeSleepIntent.mockClear()
    mocks.toastError.mockClear()
    mocks.state.activeWorktreeId = null
    mocks.state.tabsByWorktree = {}
    mocks.state.unifiedTabsByWorktree = {}
    mocks.state.ptyIdsByTabId = {}
    mocks.state.terminalLayoutsByTabId = {}
    mocks.state.lastKnownRelayPtyIdByTabId = {}
    mocks.state.deferredSshSessionIdsByTabId = {}
    mocks.state.pendingReconnectPtyIdByTabId = {}
  })

  it('starts checked terminal teardown before browsers on the sleep path', async () => {
    mocks.state.activeWorktreeId = 'wt-1'

    await runSleepWorktree('wt-1')

    expect(mocks.state.shutdownWorktreeBrowsers).toHaveBeenCalledWith('wt-1')
    expect(mocks.state.shutdownWorktreeTerminals).toHaveBeenCalledWith('wt-1', {
      keepIdentifiers: true,
      shutdownSafetyChecked: true
    })
    expect(mocks.suspendWorkspace).toHaveBeenCalledWith({ workspaceId: 'wt-1' })
    const browsersCallOrder = mocks.state.shutdownWorktreeBrowsers.mock.invocationCallOrder[0]
    const terminalsCallOrder = mocks.state.shutdownWorktreeTerminals.mock.invocationCallOrder[0]
    const suspendCallOrder = mocks.suspendWorkspace.mock.invocationCallOrder[0]
    expect(terminalsCallOrder).toBeLessThan(browsersCallOrder)
    expect(browsersCallOrder).toBeLessThan(suspendCallOrder)
  })

  it('clears activeWorktreeId before teardown when the slept worktree is active', async () => {
    mocks.state.activeWorktreeId = 'wt-1'

    await runSleepWorktree('wt-1')

    expect(mocks.state.setActiveWorktree).toHaveBeenCalledWith(null)
    const activeClear = mocks.state.setActiveWorktree.mock.invocationCallOrder[0]
    const browsersCall = mocks.state.shutdownWorktreeBrowsers.mock.invocationCallOrder[0]
    expect(activeClear).toBeLessThan(browsersCall)
  })

  it('marks active sleep intent before clearing the active slept worktree', async () => {
    mocks.state.activeWorktreeId = 'wt-1'

    await runSleepWorktree('wt-1')

    expect(mocks.markWorktreeSleepIntent).toHaveBeenCalledWith('wt-1')
    expect(mocks.clearWorktreeSleepIntent).toHaveBeenCalledWith('wt-1')
    const markCall = mocks.markWorktreeSleepIntent.mock.invocationCallOrder[0]
    const activeClear = mocks.state.setActiveWorktree.mock.invocationCallOrder[0]
    const terminalShutdown = mocks.state.shutdownWorktreeTerminals.mock.invocationCallOrder[0]
    const clearCall = mocks.clearWorktreeSleepIntent.mock.invocationCallOrder[0]
    expect(markCall).toBeLessThan(activeClear)
    expect(terminalShutdown).toBeLessThan(clearCall)
  })

  it('preserves active and browser state until legacy terminal safety is known', async () => {
    let resolvePreflight!: (reason: string | null) => void
    const getShutdownBlockReason = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolvePreflight = resolve
        })
    )
    vi.stubGlobal('window', {
      api: {
        pty: { getShutdownBlockReason },
        ephemeralVm: { suspendWorkspace: mocks.suspendWorkspace }
      },
      requestAnimationFrame: vi.fn()
    })
    mocks.state.activeWorktreeId = 'wt-1'
    mocks.state.tabsByWorktree = { 'wt-1': [{ id: 'tab-1' }] }
    mocks.state.ptyIdsByTabId = { 'tab-1': ['pty-v24'] }

    const completion = runSleepWorktree('wt-1')
    await vi.waitFor(() => expect(getShutdownBlockReason).toHaveBeenCalledWith('pty-v24'))

    expect(mocks.markWorktreeSleepIntent).not.toHaveBeenCalled()
    expect(mocks.state.setActiveWorktree).not.toHaveBeenCalled()
    expect(mocks.state.shutdownWorktreeBrowsers).not.toHaveBeenCalled()
    expect(mocks.state.shutdownWorktreeTerminals).not.toHaveBeenCalled()

    resolvePreflight(WINDOWS_LEGACY_PTY_SHUTDOWN_BLOCK_REASON)
    await completion

    expect(mocks.markWorktreeSleepIntent).not.toHaveBeenCalled()
    expect(mocks.state.setActiveWorktree).not.toHaveBeenCalled()
    expect(mocks.state.shutdownWorktreeBrowsers).not.toHaveBeenCalled()
    expect(mocks.state.shutdownWorktreeTerminals).not.toHaveBeenCalled()
    expect(mocks.clearWorktreeSleepIntent).not.toHaveBeenCalled()
  })

  it('retires checked PTY ownership before browser teardown can replace it', async () => {
    const getShutdownBlockReason = vi.fn().mockResolvedValue(null)
    vi.stubGlobal('window', {
      api: {
        pty: { getShutdownBlockReason },
        ephemeralVm: { suspendWorkspace: mocks.suspendWorkspace }
      },
      requestAnimationFrame: vi.fn()
    })
    mocks.state.activeWorktreeId = 'wt-1'
    mocks.state.tabsByWorktree = { 'wt-1': [{ id: 'tab-1' }] }
    mocks.state.ptyIdsByTabId = { 'tab-1': ['pty-safe'] }
    mocks.state.shutdownWorktreeTerminals.mockImplementationOnce(async () => {
      mocks.state.ptyIdsByTabId = { 'tab-1': [] }
    })
    const unsafeReplacement = vi.fn(() => {
      if ((mocks.state.ptyIdsByTabId['tab-1'] ?? []).length > 0) {
        mocks.state.ptyIdsByTabId = { 'tab-1': ['pty-v24'] }
      }
    })
    mocks.state.shutdownWorktreeBrowsers.mockImplementationOnce(async () => unsafeReplacement())

    await runSleepWorktree('wt-1')

    expect(getShutdownBlockReason).toHaveBeenCalledTimes(1)
    expect(getShutdownBlockReason).toHaveBeenCalledWith('pty-safe')
    expect(unsafeReplacement).toHaveBeenCalledOnce()
    expect(mocks.state.ptyIdsByTabId['tab-1']).toEqual([])
    const terminalCall = mocks.state.shutdownWorktreeTerminals.mock.invocationCallOrder[0]
    const browserCall = mocks.state.shutdownWorktreeBrowsers.mock.invocationCallOrder[0]
    expect(terminalCall).toBeLessThan(browserCall)
  })

  it('preserves active row position through section-scoped sidebar row ids', async () => {
    const requestAnimationFrame = vi.fn(() => 1)
    const scroller = {
      dispatchEvent: vi.fn(),
      scrollHeight: 100,
      scrollTop: 0
    }
    const row = {
      closest: (selector: string) => (selector === '[data-worktree-virtual-row]' ? row : null),
      getBoundingClientRect: () => ({ top: 42 })
    }
    const option = {
      dataset: { worktreeId: 'wt-1' },
      closest: (selector: string) => (selector === '[data-worktree-virtual-row]' ? row : null),
      querySelector: () => null
    }
    vi.stubGlobal('document', {
      querySelector: (selector: string) =>
        selector === '[data-worktree-sidebar]' ? scroller : null,
      querySelectorAll: (selector: string) => (selector === '[data-worktree-id]' ? [option] : [])
    })
    vi.stubGlobal('window', { requestAnimationFrame })
    mocks.state.activeWorktreeId = 'wt-1'

    await runSleepWorktree('wt-1')

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
  })

  it('anchors sleep restoration to the natural duplicate row when no primary row is marked', async () => {
    const requestAnimationFrame = vi.fn(() => 1)
    const scroller = {
      dispatchEvent: vi.fn(),
      scrollHeight: 100,
      scrollTop: 0
    }
    const pinnedGetBoundingClientRect = vi.fn(() => ({ top: 10 }))
    const naturalGetBoundingClientRect = vi.fn(() => ({ top: 42 }))
    const pinnedRow = {
      getBoundingClientRect: pinnedGetBoundingClientRect
    }
    const naturalRow = {
      getBoundingClientRect: naturalGetBoundingClientRect
    }
    const pinnedOption = {
      dataset: { worktreeId: 'wt-1', worktreeRowKey: 'pinned:wt-1' },
      closest: (selector: string) =>
        selector === '[data-worktree-virtual-row]' ? pinnedRow : null,
      querySelector: () => null
    }
    const naturalOption = {
      dataset: { worktreeId: 'wt-1', worktreeRowKey: 'all:wt-1' },
      closest: (selector: string) =>
        selector === '[data-worktree-virtual-row]' ? naturalRow : null,
      querySelector: () => null
    }
    vi.stubGlobal('document', {
      querySelector: (selector: string) =>
        selector === '[data-worktree-sidebar]' ? scroller : null,
      querySelectorAll: (selector: string) =>
        selector === '[data-worktree-id]' ? [pinnedOption, naturalOption] : []
    })
    vi.stubGlobal('window', { requestAnimationFrame })
    mocks.state.activeWorktreeId = 'wt-1'

    await runSleepWorktree('wt-1')

    expect(naturalGetBoundingClientRect).toHaveBeenCalled()
    expect(pinnedGetBoundingClientRect).not.toHaveBeenCalled()
  })

  it('leaves activeWorktreeId alone when sleeping a background worktree', async () => {
    mocks.state.activeWorktreeId = 'wt-other'

    await runSleepWorktree('wt-1')

    expect(mocks.state.setActiveWorktree).not.toHaveBeenCalled()
    expect(mocks.state.suppressPtyExit).not.toHaveBeenCalled()
    expect(mocks.markWorktreeSleepIntent).not.toHaveBeenCalled()
  })

  it('surfaces a toast after a post-terminal browser failure', async () => {
    mocks.state.activeWorktreeId = 'wt-1'
    mocks.state.shutdownWorktreeBrowsers.mockRejectedValueOnce(new Error('boom'))
    mocks.state.tabsByWorktree = { 'wt-1': [{ id: 'tab-1' }] }
    mocks.state.ptyIdsByTabId = { 'tab-1': ['pty-1'] }

    await runSleepWorktree('wt-1')

    expect(mocks.state.shutdownWorktreeTerminals).toHaveBeenCalledWith('wt-1', {
      keepIdentifiers: true,
      shutdownSafetyChecked: true
    })
    expect(mocks.suspendWorkspace).not.toHaveBeenCalled()
    expect(mocks.clearWorktreeSleepIntent).toHaveBeenCalledWith('wt-1')
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Failed to sleep workspace',
      expect.objectContaining({ description: 'boom' })
    )
  })

  it('continues sleeping later worktrees when one selected worktree fails', async () => {
    mocks.state.shutdownWorktreeBrowsers.mockImplementation((worktreeId: string) => {
      if (worktreeId === 'wt-1') {
        return Promise.reject(new Error('first failed'))
      }
      return Promise.resolve()
    })

    await runSleepWorktrees(['wt-1', 'wt-2'])

    expect(mocks.state.shutdownWorktreeTerminals).toHaveBeenCalledWith('wt-1', {
      keepIdentifiers: true,
      shutdownSafetyChecked: true
    })
    expect(mocks.state.shutdownWorktreeBrowsers).toHaveBeenCalledWith('wt-2')
    expect(mocks.state.shutdownWorktreeTerminals).toHaveBeenCalledWith('wt-2', {
      keepIdentifiers: true,
      shutdownSafetyChecked: true
    })
    expect(mocks.suspendWorkspace).toHaveBeenCalledWith({ workspaceId: 'wt-2' })
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Failed to sleep some workspaces',
      expect.objectContaining({ description: 'first failed' })
    )
  })

  it('sleeps multiple worktrees and clears active only once when included', async () => {
    mocks.state.activeWorktreeId = 'wt-2'

    await runSleepWorktrees(['wt-1', 'wt-2'])

    expect(mocks.state.setActiveWorktree).toHaveBeenCalledTimes(1)
    expect(mocks.state.setActiveWorktree).toHaveBeenCalledWith(null)
    expect(mocks.state.shutdownWorktreeBrowsers).toHaveBeenNthCalledWith(1, 'wt-1')
    expect(mocks.state.shutdownWorktreeTerminals).toHaveBeenNthCalledWith(1, 'wt-1', {
      keepIdentifiers: true,
      shutdownSafetyChecked: true
    })
    expect(mocks.state.shutdownWorktreeBrowsers).toHaveBeenNthCalledWith(2, 'wt-2')
    expect(mocks.state.shutdownWorktreeTerminals).toHaveBeenNthCalledWith(2, 'wt-2', {
      keepIdentifiers: true,
      shutdownSafetyChecked: true
    })
    expect(mocks.suspendWorkspace).toHaveBeenNthCalledWith(1, { workspaceId: 'wt-1' })
    expect(mocks.suspendWorkspace).toHaveBeenNthCalledWith(2, { workspaceId: 'wt-2' })
  })
})
