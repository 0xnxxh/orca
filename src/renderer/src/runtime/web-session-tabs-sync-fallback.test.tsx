// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import { SESSION_TABS_ATOMIC_SUBSCRIBE_ALL_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import type { PublicKnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import type { RuntimeMobileSessionTabsResult, RuntimeStatus } from '../../../shared/runtime-types'
import type { Repo, TerminalTab } from '../../../shared/types'
import { useAppStore } from '../store'
import { makeWorktree } from '../store/slices/store-test-helpers'
import { replaceRuntimeEnvironmentRevisions } from './runtime-environment-revision'
import { useWebSessionTabsSync } from './use-web-session-tabs-sync'
import { resetWebSessionTabsSnapshotFreshnessForTests } from './web-session-tabs-sync'

const ENV = 'remote-env'
const RUNTIME = 'remote-runtime'
const REPO = 'remote-repo'
const WT = `${REPO}::/remote/worktree`
const REVISION = 17
const initialState = useAppStore.getInitialState()
type SubscribeCallbacks = Parameters<typeof window.api.runtimeEnvironments.subscribe>[1]

function snapshot(): RuntimeMobileSessionTabsResult {
  return {
    worktree: WT,
    publicationEpoch: 'epoch-1',
    snapshotVersion: 1,
    activeGroupId: null,
    activeTabId: null,
    activeTabType: null,
    tabs: []
  }
}

function globalResponse(result: unknown): RuntimeRpcResponse<unknown> {
  return { id: 'subscribe-all', ok: true, result, _meta: { runtimeId: RUNTIME } }
}

function seedRemoteWorkspace(): void {
  const environment: PublicKnownRuntimeEnvironment = {
    id: ENV,
    name: 'Remote host',
    createdAt: 1,
    updatedAt: 1,
    pairingRevision: REVISION,
    lastUsedAt: null,
    runtimeId: RUNTIME,
    endpoints: [
      { id: 'endpoint', kind: 'websocket', label: 'WebSocket', endpoint: 'ws://remote.invalid' }
    ],
    preferredEndpointId: 'endpoint'
  }
  const repo: Repo = {
    id: REPO,
    path: '/remote/repo',
    displayName: 'Remote repo',
    badgeColor: '#000',
    addedAt: 1,
    connectionId: null,
    executionHostId: `runtime:${ENV}`
  }
  const tab: TerminalTab = {
    id: 'local-tab',
    ptyId: 'local-pty',
    worktreeId: WT,
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
  const status: RuntimeStatus = {
    runtimeId: RUNTIME,
    rendererGraphEpoch: 1,
    graphStatus: 'ready',
    authoritativeWindowId: null,
    liveTabCount: 0,
    liveLeafCount: 0,
    capabilities: [SESSION_TABS_ATOMIC_SUBSCRIBE_ALL_RUNTIME_CAPABILITY]
  }
  replaceRuntimeEnvironmentRevisions([environment])
  useAppStore.setState(
    {
      ...initialState,
      settings: { ...getDefaultSettings('/tmp'), activeRuntimeEnvironmentId: ENV },
      repos: [repo],
      worktreesByRepo: {
        [REPO]: [
          makeWorktree({
            id: WT,
            repoId: REPO,
            path: '/remote/worktree',
            hostId: `runtime:${ENV}`,
            runtimeOwnerEnvironmentId: ENV
          })
        ]
      },
      activeRepoId: REPO,
      activeWorktreeId: WT,
      activeWorkspaceExecutionHostId: `runtime:${ENV}`,
      tabsByWorktree: { [WT]: [tab] },
      ptyIdsByTabId: { [tab.id]: ['local-pty'] },
      runtimeEnvironments: [environment],
      runtimeStatusByEnvironmentId: new Map([
        [ENV, { status, checkedAt: 1, connectionGeneration: 3 }]
      ]),
      workspaceSessionReady: true
    },
    true
  )
}

function setRuntimeCapabilities(capabilities: RuntimeStatus['capabilities']): void {
  const current = useAppStore.getState().runtimeStatusByEnvironmentId.get(ENV)
  if (!current?.status) {
    throw new Error('Expected seeded remote runtime status')
  }
  useAppStore.setState({
    runtimeStatusByEnvironmentId: new Map([
      [ENV, { ...current, status: { ...current.status, capabilities } }]
    ])
  })
}

describe('useWebSessionTabsSync global fallback', () => {
  const runtimeCall = vi.fn()
  const runtimeSubscribe = vi.fn()
  const globalUnsubscribe = vi.fn()
  const activeUnsubscribe = vi.fn()
  let globalCallbacks: SubscribeCallbacks | undefined
  let activeCallbacks: SubscribeCallbacks | undefined

  beforeEach(() => {
    resetWebSessionTabsSnapshotFreshnessForTests()
    vi.clearAllMocks()
    globalCallbacks = undefined
    activeCallbacks = undefined
    runtimeCall.mockImplementation(async ({ method }: { method: string }) => ({
      id: method,
      ok: true,
      result: method === 'session.tabs.listAll' ? { snapshots: [] } : snapshot()
    }))
    runtimeSubscribe.mockImplementation(
      async (args: { method: string }, callbacks: SubscribeCallbacks) => {
        if (args.method === 'session.tabs.subscribeAll') {
          globalCallbacks = callbacks
        } else {
          activeCallbacks = callbacks
        }
        return {
          unsubscribe:
            args.method === 'session.tabs.subscribeAll' ? globalUnsubscribe : activeUnsubscribe,
          sendBinary: vi.fn()
        }
      }
    )
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { runtimeEnvironments: { call: runtimeCall, subscribe: runtimeSubscribe } }
    })
    seedRemoteWorkspace()
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
    replaceRuntimeEnvironmentRevisions([])
    resetWebSessionTabsSnapshotFreshnessForTests()
  })

  it('uses listAll and the scoped stream when subscribeAll cannot start', async () => {
    let rejectGlobal: (error: Error) => void = () => {}
    runtimeSubscribe.mockImplementation(async (args: { method: string }) => {
      if (args.method === 'session.tabs.subscribeAll') {
        return new Promise<never>((_resolve, reject) => {
          rejectGlobal = reject
        })
      }
      return { unsubscribe: activeUnsubscribe, sendBinary: vi.fn() }
    })

    const hook = renderHook(() => useWebSessionTabsSync())
    await waitFor(() => expect(runtimeSubscribe).toHaveBeenCalledTimes(2))
    await act(async () => rejectGlobal(new Error('unavailable')))

    await waitFor(() =>
      expect(runtimeSubscribe.mock.calls.map(([args]) => args.method)).toEqual([
        'session.tabs.subscribeAll',
        'session.tabs.subscribe'
      ])
    )
    expect(runtimeCall.mock.calls.map(([args]) => args.method)).toContain('session.tabs.listAll')
    hook.unmount()
    expect(activeUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('once-gates repeated pre-initial failures', async () => {
    const hook = renderHook(() => useWebSessionTabsSync())
    await waitFor(() => expect(globalCallbacks).toBeDefined())
    await act(async () => {
      globalCallbacks?.onResponse(globalResponse(null))
      globalCallbacks?.onResponse({
        id: 'subscribe-all',
        ok: false,
        error: { code: 'method_not_found', message: 'missing' }
      })
      globalCallbacks?.onError?.({ code: 'transport_closed', message: 'closed' })
      globalCallbacks?.onClose?.()
    })

    await waitFor(() =>
      expect(
        runtimeSubscribe.mock.calls.filter(([args]) => args.method === 'session.tabs.subscribe')
      ).toHaveLength(1)
    )
    expect(
      runtimeCall.mock.calls.filter(([args]) => args.method === 'session.tabs.listAll')
    ).toHaveLength(1)
    hook.unmount()
  })

  it('keeps later active wake updates on a protocol-v2 fallback stream', async () => {
    setRuntimeCapabilities(undefined)
    const hook = renderHook(() => useWebSessionTabsSync())
    await waitFor(() => {
      expect(globalCallbacks).toBeDefined()
      expect(activeCallbacks).toBeDefined()
    })
    await act(async () =>
      globalCallbacks?.onResponse({
        id: 'subscribe-all',
        ok: false,
        error: { code: 'method_not_found', message: 'missing' }
      })
    )
    await waitFor(() => expect(activeCallbacks).toBeDefined())
    useAppStore.setState({
      tabsByWorktree: {
        [WT]: [
          {
            id: 'slept-tab',
            ptyId: null,
            worktreeId: WT,
            title: 'Terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 2
          }
        ]
      },
      ptyIdsByTabId: {}
    })
    await act(async () =>
      activeCallbacks?.onResponse(
        globalResponse({ ...snapshot(), snapshotVersion: 2, type: 'updated' })
      )
    )

    await waitFor(() =>
      expect(runtimeCall.mock.calls.map(([args]) => args.method)).toContain(
        'session.tabs.createTerminal'
      )
    )
    hook.unmount()
  })

  it('keeps the scoped stream after a pre-atomic v3 global batch', async () => {
    setRuntimeCapabilities([])

    const hook = renderHook(() => useWebSessionTabsSync())
    await waitFor(() => {
      expect(globalCallbacks).toBeDefined()
      expect(activeCallbacks).toBeDefined()
    })
    await act(async () =>
      globalCallbacks?.onResponse(globalResponse({ type: 'snapshots', snapshots: [snapshot()] }))
    )

    expect(runtimeSubscribe.mock.calls.map(([args]) => args.method)).toEqual([
      'session.tabs.subscribeAll',
      'session.tabs.subscribe'
    ])
    expect(activeUnsubscribe).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('restores scoped updates when a proven global stream closes', async () => {
    const hook = renderHook(() => useWebSessionTabsSync())
    await waitFor(() => expect(globalCallbacks).toBeDefined())
    await act(async () =>
      globalCallbacks?.onResponse(globalResponse({ type: 'snapshots', snapshots: [snapshot()] }))
    )
    await waitFor(() => expect(activeUnsubscribe).toHaveBeenCalledOnce())
    expect(runtimeSubscribe).toHaveBeenCalledTimes(2)

    await act(async () => globalCallbacks?.onClose?.())
    await waitFor(() => expect(runtimeSubscribe).toHaveBeenCalledTimes(3))
    expect(runtimeSubscribe.mock.calls[2]?.[0].method).toBe('session.tabs.subscribe')
    hook.unmount()
  })

  it('times out to listAll and the scoped stream', async () => {
    vi.useFakeTimers()
    try {
      const hook = renderHook(() => useWebSessionTabsSync())
      await act(async () => {})
      expect(runtimeSubscribe).toHaveBeenCalledTimes(2)

      await act(async () => vi.advanceTimersByTimeAsync(15_000))
      expect(runtimeCall.mock.calls.map(([args]) => args.method)).toContain('session.tabs.listAll')
      expect(runtimeSubscribe.mock.calls.map(([args]) => args.method)).toEqual([
        'session.tabs.subscribeAll',
        'session.tabs.subscribe'
      ])
      hook.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
