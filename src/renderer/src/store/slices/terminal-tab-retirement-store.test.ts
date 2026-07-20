import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import { WINDOWS_LEGACY_PTY_SHUTDOWN_BLOCK_REASON } from '../../../../shared/pty-shutdown-safety'

const mockKill = vi.fn().mockResolvedValue(undefined)
const mockGetShutdownBlockReason = vi.fn().mockResolvedValue(null)
const mockRuntimeCall = vi.fn().mockResolvedValue({
  id: 'rpc-1',
  ok: true,
  result: {},
  _meta: { runtimeId: 'local-runtime' }
})

vi.stubGlobal('window', {
  api: {
    pty: { kill: mockKill, getShutdownBlockReason: mockGetShutdownBlockReason },
    runtime: { call: mockRuntimeCall },
    runtimeEnvironments: { call: vi.fn() }
  }
})

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { toast } from 'sonner'

import {
  capturedPanesByTabId,
  parkedWatchersByTabId
} from '@/components/terminal-pane/terminal-parked-watcher-registry'
import {
  createTestStore,
  makeTab,
  makeTabGroup,
  makeUnifiedTab,
  seedStore
} from './store-test-helpers'

function sleepingRecord(paneKey: string, tabId: string): SleepingAgentSessionRecord {
  return {
    paneKey,
    tabId,
    worktreeId: 'wt-1',
    agent: 'codex',
    providerSession: { key: 'session_id', id: paneKey },
    prompt: 'continue',
    state: 'working',
    capturedAt: 1,
    updatedAt: 1
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('terminal tab retirement store boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
    delete (globalThis as { __ORCA_WEB_CLIENT__?: boolean }).__ORCA_WEB_CLIENT__
    mockKill.mockResolvedValue(undefined)
    mockGetShutdownBlockReason.mockResolvedValue(null)
    mockRuntimeCall.mockResolvedValue({
      id: 'rpc-1',
      ok: true,
      result: {},
      _meta: { runtimeId: 'local-runtime' }
    })
    parkedWatchersByTabId.clear()
    capturedPanesByTabId.clear()
  })

  it('retires split, relay, deferred, and pending sessions for a parked tab', async () => {
    const store = createTestStore()
    const dispose = vi.fn()
    const siblingRecord = sleepingRecord('tab-2:leaf-2', 'tab-2')
    seedStore(store, {
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1', ptyId: 'pty-primary' })]
      },
      ptyIdsByTabId: { 'tab-1': ['pty-primary', 'pty-split'] },
      terminalLayoutsByTabId: {
        'tab-1': {
          root: null,
          activeLeafId: null,
          expandedLeafId: null,
          ptyIdsByLeafId: { leaf1: 'pty-primary', leaf2: 'pty-split' }
        }
      },
      lastKnownRelayPtyIdByTabId: { 'tab-1': 'ssh:ssh-1@@relay' },
      deferredSshSessionIdsByTabId: { 'tab-1': 'pty-deferred' },
      pendingReconnectPtyIdByTabId: { 'tab-1': 'pty-pending' },
      sleepingAgentSessionsByPaneKey: {
        'tab-1:leaf-1': sleepingRecord('tab-1:leaf-1', 'tab-1'),
        'legacy-key': sleepingRecord('legacy-key', 'tab-1'),
        'tab-2:leaf-2': siblingRecord
      }
    })
    parkedWatchersByTabId.set('tab-1', {
      worktreeId: 'wt-1',
      tabPtyId: 'pty-primary',
      paneIdByPtyId: new Map([['pty-primary', 1]]),
      disposersByPtyId: new Map([['pty-primary', dispose]])
    })
    capturedPanesByTabId.set('tab-1', { worktreeId: 'wt-1', panes: [] })

    store.getState().closeTab('tab-1')
    await vi.waitFor(() => expect(mockKill).toHaveBeenCalledTimes(5))

    expect(new Set(mockKill.mock.calls.map(([ptyId]) => ptyId))).toEqual(
      new Set(['pty-primary', 'pty-split', 'ssh:ssh-1@@relay', 'pty-deferred', 'pty-pending'])
    )
    expect(store.getState().tabsByWorktree['wt-1']).toEqual([])
    expect(store.getState().deferredSshSessionIdsByTabId['tab-1']).toBeUndefined()
    expect(store.getState().pendingReconnectPtyIdByTabId['tab-1']).toBeUndefined()
    expect(store.getState().sleepingAgentSessionsByPaneKey).toEqual({
      'tab-2:leaf-2': siblingRecord
    })
    expect(store.getState().sleepingAgentSessionsByPaneKey['tab-2:leaf-2']).toBe(siblingRecord)
    expect(dispose).toHaveBeenCalledOnce()
    expect(parkedWatchersByTabId.has('tab-1')).toBe(false)
    expect(capturedPanesByTabId.has('tab-1')).toBe(false)
  })

  it('routes runtime handles to runtime close and preserves shared PTYs', async () => {
    const store = createTestStore()
    seedStore(store, {
      tabsByWorktree: {
        'wt-1': [
          makeTab({ id: 'tab-1', worktreeId: 'wt-1', ptyId: 'remote:terminal-1' }),
          makeTab({ id: 'tab-2', worktreeId: 'wt-1', ptyId: 'pty-shared' })
        ]
      },
      ptyIdsByTabId: {
        'tab-1': ['remote:terminal-1', 'pty-shared'],
        'tab-2': ['pty-shared']
      }
    })

    store.getState().closeTab('tab-1')
    await vi.waitFor(() => expect(mockRuntimeCall).toHaveBeenCalled())

    expect(mockRuntimeCall).toHaveBeenCalledWith({
      method: 'terminal.close',
      params: { terminal: 'terminal-1' }
    })
    expect(mockKill).not.toHaveBeenCalled()
  })

  it('preserves shared-owner snapshots while closing the source tab', async () => {
    const store = createTestStore()
    const snapshot = { snapshot: 'shared snapshot' }
    const coldRestore = { scrollback: 'shared scrollback', cwd: 'C:\\workspace' }
    seedStore(store, {
      tabsByWorktree: {
        'wt-1': [
          makeTab({ id: 'tab-1', worktreeId: 'wt-1', ptyId: 'pty-shared' }),
          makeTab({ id: 'tab-2', worktreeId: 'wt-1', ptyId: 'pty-shared' })
        ]
      },
      ptyIdsByTabId: { 'tab-1': ['pty-shared'], 'tab-2': ['pty-shared'] },
      pendingSnapshotByPtyId: { 'pty-shared': snapshot },
      pendingColdRestoreByPtyId: { 'pty-shared': coldRestore }
    })

    store.getState().closeTab('tab-1')
    await Promise.resolve()

    expect(mockKill).not.toHaveBeenCalled()
    expect(store.getState().pendingSnapshotByPtyId['pty-shared']).toBe(snapshot)
    expect(store.getState().pendingColdRestoreByPtyId['pty-shared']).toBe(coldRestore)
  })

  it('reconciles natural exit without issuing teardown or revoking resume authority', async () => {
    const store = createTestStore()
    const record = sleepingRecord('tab-1:leaf-1', 'tab-1')
    seedStore(store, {
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1', ptyId: 'pty-dead' })]
      },
      ptyIdsByTabId: { 'tab-1': ['pty-dead'] },
      sleepingAgentSessionsByPaneKey: { 'tab-1:leaf-1': record }
    })

    store.getState().closeTab('tab-1', { reason: 'pty-exit' })
    await Promise.resolve()

    expect(mockKill).not.toHaveBeenCalled()
    expect(mockRuntimeCall).not.toHaveBeenCalled()
    expect(store.getState().sleepingAgentSessionsByPaneKey['tab-1:leaf-1']).toBe(record)
  })

  it('does not recreate PTY indexes for a tab that no longer exists', () => {
    const store = createTestStore()

    store.getState().updateTabPtyId('closed-tab', 'pty-after-close')

    expect(store.getState().ptyIdsByTabId['closed-tab']).toBeUndefined()
    expect(store.getState().lastKnownRelayPtyIdByTabId['closed-tab']).toBeUndefined()
  })

  it('retires a unified-only terminal instead of removing only its wrapper', async () => {
    const store = createTestStore()
    const unified = makeUnifiedTab({
      id: 'unified-tab-1',
      entityId: 'terminal-tab-1',
      worktreeId: 'wt-1',
      groupId: 'group-1'
    })
    seedStore(store, {
      tabsByWorktree: { 'wt-1': [] },
      unifiedTabsByWorktree: { 'wt-1': [unified] },
      groupsByWorktree: {
        'wt-1': [
          makeTabGroup({
            id: 'group-1',
            worktreeId: 'wt-1',
            activeTabId: unified.id,
            tabOrder: [unified.id]
          })
        ]
      },
      ptyIdsByTabId: { 'terminal-tab-1': ['pty-unified-only'] }
    })

    store.getState().closeUnifiedTab(unified.id)
    await vi.waitFor(() => expect(mockKill).toHaveBeenCalledWith('pty-unified-only'))

    expect(store.getState().unifiedTabsByWorktree['wt-1']).toEqual([])
    expect(store.getState().ptyIdsByTabId['terminal-tab-1']).toBeUndefined()
  })

  it('lets a paired host own runtime teardown while pruning local state', async () => {
    const store = createTestStore()
    seedStore(store, {
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1', ptyId: 'remote:terminal-1' })]
      },
      ptyIdsByTabId: { 'tab-1': ['remote:terminal-1'] }
    })

    store.getState().closeTab('tab-1', { remoteCloseOwnedByHost: true })
    await Promise.resolve()

    expect(mockRuntimeCall).not.toHaveBeenCalled()
    expect(store.getState().tabsByWorktree['wt-1']).toEqual([])
  })

  it('keeps the tab retired and reports provider rejection without an unhandled promise', async () => {
    const store = createTestStore()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockKill.mockRejectedValueOnce(new Error('provider unavailable'))
    seedStore(store, {
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1', ptyId: 'pty-1' })]
      },
      ptyIdsByTabId: { 'tab-1': ['pty-1'] }
    })

    store.getState().closeTab('tab-1')
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('[terminal-retirement] provider teardown failed', {
        tabId: 'tab-1',
        localOrSshFailures: 1,
        runtimeFailures: 0
      })
    )

    expect(store.getState().tabsByWorktree['wt-1']).toEqual([])
    warn.mockRestore()
  })

  it('keeps ordinary non-Windows close synchronous and skips Windows inventory', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' })
    const store = createTestStore()
    seedStore(store, {
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1', ptyId: 'pty-1' })]
      },
      ptyIdsByTabId: { 'tab-1': ['pty-1'] }
    })

    store.getState().closeTab('tab-1')

    expect(store.getState().tabsByWorktree['wt-1']).toEqual([])
    expect(mockGetShutdownBlockReason).not.toHaveBeenCalled()
    expect(mockKill).toHaveBeenCalledWith('pty-1')
  })

  it('does not run native shutdown inventory in a Windows web client', () => {
    ;(globalThis as { __ORCA_WEB_CLIENT__?: boolean }).__ORCA_WEB_CLIENT__ = true
    const store = createTestStore()
    seedStore(store, {
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1', ptyId: 'remote:terminal-1' })]
      },
      ptyIdsByTabId: { 'tab-1': ['remote:terminal-1'] }
    })

    store.getState().closeTab('tab-1')

    expect(store.getState().tabsByWorktree['wt-1']).toEqual([])
    expect(mockGetShutdownBlockReason).not.toHaveBeenCalled()
  })

  it('keeps a legacy Windows tab and PTY ownership visible when shutdown is unsafe', async () => {
    const store = createTestStore()
    mockGetShutdownBlockReason.mockResolvedValueOnce(WINDOWS_LEGACY_PTY_SHUTDOWN_BLOCK_REASON)
    seedStore(store, {
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1', ptyId: 'pty-v24' })]
      },
      ptyIdsByTabId: { 'tab-1': ['pty-v24'] }
    })

    store.getState().closeTab('tab-1')
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Terminal kept open for safety',
        expect.objectContaining({
          description: expect.stringContaining('Task Manager')
        })
      )
    )

    expect(mockGetShutdownBlockReason).toHaveBeenCalledWith('pty-v24')
    expect(mockKill).not.toHaveBeenCalled()
    expect(store.getState().tabsByWorktree['wt-1']).toHaveLength(1)
    expect(store.getState().ptyIdsByTabId['tab-1']).toEqual(['pty-v24'])
  })

  it('replans after async safety inventory before retiring current PTY ownership', async () => {
    const store = createTestStore()
    const firstPreflight = deferred<null>()
    mockGetShutdownBlockReason.mockImplementationOnce(() => firstPreflight.promise)
    seedStore(store, {
      tabsByWorktree: {
        'wt-1': [
          makeTab({ id: 'tab-1', worktreeId: 'wt-1', ptyId: 'pty-before' }),
          makeTab({ id: 'survivor', worktreeId: 'wt-1', ptyId: null })
        ]
      },
      ptyIdsByTabId: { 'tab-1': ['pty-before'], survivor: [] }
    })

    store.getState().closeTab('tab-1')
    expect(mockGetShutdownBlockReason).toHaveBeenCalledWith('pty-before')

    store.setState({
      tabsByWorktree: {
        'wt-1': [
          makeTab({ id: 'tab-1', worktreeId: 'wt-1', ptyId: 'pty-after' }),
          makeTab({ id: 'survivor', worktreeId: 'wt-1', ptyId: 'pty-before' })
        ]
      },
      ptyIdsByTabId: { 'tab-1': ['pty-after'], survivor: ['pty-before'] }
    })
    firstPreflight.resolve(null)

    await vi.waitFor(() => expect(mockGetShutdownBlockReason).toHaveBeenCalledWith('pty-after'))
    await vi.waitFor(() => expect(mockKill).toHaveBeenCalledWith('pty-after'))

    expect(mockKill).not.toHaveBeenCalledWith('pty-before')
    expect(store.getState().tabsByWorktree['wt-1'].map((tab) => tab.id)).toEqual(['survivor'])
    expect(store.getState().ptyIdsByTabId.survivor).toEqual(['pty-before'])
  })

  it('keeps sleep state and PTY ownership intact when legacy shutdown is unsafe', async () => {
    const store = createTestStore()
    mockGetShutdownBlockReason.mockResolvedValueOnce(WINDOWS_LEGACY_PTY_SHUTDOWN_BLOCK_REASON)
    seedStore(store, {
      tabsByWorktree: {
        'wt-1': [makeTab({ id: 'tab-1', worktreeId: 'wt-1', ptyId: 'pty-v24' })]
      },
      ptyIdsByTabId: { 'tab-1': ['pty-v24'] }
    })

    await expect(
      store.getState().shutdownWorktreeTerminals('wt-1', { keepIdentifiers: true })
    ).rejects.toThrow(WINDOWS_LEGACY_PTY_SHUTDOWN_BLOCK_REASON)

    expect(mockGetShutdownBlockReason).toHaveBeenCalledWith('pty-v24')
    expect(mockKill).not.toHaveBeenCalled()
    expect(store.getState().tabsByWorktree['wt-1']).toHaveLength(1)
    expect(store.getState().ptyIdsByTabId['tab-1']).toEqual(['pty-v24'])
  })
})
