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
import { resetWebSessionTabsSnapshotFreshnessForTests } from './web-session-tabs-sync'
import { useWebSessionTabsSync } from './use-web-session-tabs-sync'

const ENVIRONMENT_ID = 'remote-env'
const RUNTIME_ID = 'remote-runtime'
const REPO_ID = 'remote-repo'
const WORKTREE_ID = `${REPO_ID}::/remote/worktree`
const SECOND_WORKTREE_ID = `${REPO_ID}::/remote/second-worktree`
const PAIRING_REVISION = 17
const initialState = useAppStore.getInitialState()
type RuntimeSubscribeCallbacks = Parameters<typeof window.api.runtimeEnvironments.subscribe>[1]

function environment(): PublicKnownRuntimeEnvironment {
  return {
    id: ENVIRONMENT_ID,
    name: 'Remote host',
    createdAt: 1,
    updatedAt: 1,
    pairingRevision: PAIRING_REVISION,
    lastUsedAt: null,
    runtimeId: RUNTIME_ID,
    endpoints: [
      {
        id: 'remote-endpoint',
        kind: 'websocket',
        label: 'WebSocket',
        endpoint: 'ws://remote.invalid'
      }
    ],
    preferredEndpointId: 'remote-endpoint'
  }
}

function runtimeStatus(): RuntimeStatus {
  return {
    runtimeId: RUNTIME_ID,
    rendererGraphEpoch: 1,
    graphStatus: 'ready',
    authoritativeWindowId: null,
    liveTabCount: 0,
    liveLeafCount: 0,
    capabilities: [SESSION_TABS_ATOMIC_SUBSCRIBE_ALL_RUNTIME_CAPABILITY]
  }
}

function repo(): Repo {
  return {
    id: REPO_ID,
    path: '/remote/repo',
    displayName: 'Remote repo',
    badgeColor: '#000',
    addedAt: 1,
    connectionId: null,
    executionHostId: `runtime:${ENVIRONMENT_ID}`
  }
}

function worktree(id = WORKTREE_ID) {
  return makeWorktree({
    id,
    repoId: REPO_ID,
    path: id === WORKTREE_ID ? '/remote/worktree' : '/remote/second-worktree',
    hostId: `runtime:${ENVIRONMENT_ID}`,
    runtimeOwnerEnvironmentId: ENVIRONMENT_ID
  })
}

function snapshot(
  overrides: Partial<RuntimeMobileSessionTabsResult> = {}
): RuntimeMobileSessionTabsResult {
  return {
    worktree: WORKTREE_ID,
    publicationEpoch: 'epoch-1',
    snapshotVersion: 1,
    activeGroupId: null,
    activeTabId: null,
    activeTabType: null,
    tabs: [],
    ...overrides
  }
}

function seedRemoteWorkspace(): void {
  const remoteEnvironment = environment()
  const localTab: TerminalTab = {
    id: 'local-tab',
    ptyId: 'local-pty',
    worktreeId: WORKTREE_ID,
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
  replaceRuntimeEnvironmentRevisions([remoteEnvironment])
  useAppStore.setState(
    {
      ...initialState,
      settings: {
        ...getDefaultSettings('/tmp'),
        activeRuntimeEnvironmentId: ENVIRONMENT_ID
      },
      repos: [repo()],
      worktreesByRepo: { [REPO_ID]: [worktree()] },
      activeRepoId: REPO_ID,
      activeWorktreeId: WORKTREE_ID,
      activeWorkspaceExecutionHostId: `runtime:${ENVIRONMENT_ID}`,
      tabsByWorktree: { [WORKTREE_ID]: [localTab] },
      ptyIdsByTabId: { [localTab.id]: ['local-pty'] },
      runtimeEnvironments: [remoteEnvironment],
      runtimeStatusByEnvironmentId: new Map([
        [
          ENVIRONMENT_ID,
          {
            status: runtimeStatus(),
            checkedAt: 1,
            connectionGeneration: 3
          }
        ]
      ]),
      workspaceSessionReady: true
    },
    true
  )
}

function response(result: unknown): RuntimeRpcResponse<unknown> {
  return { id: 'subscribe-all', ok: true, result, _meta: { runtimeId: RUNTIME_ID } }
}

describe('useWebSessionTabsSync subscription topology', () => {
  const globalUnsubscribe = vi.fn()
  const activeUnsubscribe = vi.fn()
  const runtimeCall = vi.fn()
  const runtimeSubscribe = vi.fn()
  let globalCallbacks: RuntimeSubscribeCallbacks | undefined

  beforeEach(() => {
    resetWebSessionTabsSnapshotFreshnessForTests()
    globalUnsubscribe.mockReset()
    activeUnsubscribe.mockReset()
    runtimeCall.mockReset()
    runtimeSubscribe.mockReset()
    globalCallbacks = undefined
    runtimeCall.mockImplementation(
      async ({ method, params }: { method: string; params?: { worktree?: string } }) => ({
        id: method,
        ok: true,
        result:
          method === 'session.tabs.listAll'
            ? { snapshots: [] }
            : snapshot({
                worktree: params?.worktree?.startsWith('id:')
                  ? params.worktree.slice(3)
                  : WORKTREE_ID
              }),
        _meta: { runtimeId: RUNTIME_ID }
      })
    )
    runtimeSubscribe.mockImplementation(
      async (args: { method: string }, callbacks: RuntimeSubscribeCallbacks) => {
        if (args.method === 'session.tabs.subscribeAll') {
          globalCallbacks = callbacks
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
      value: {
        runtimeEnvironments: {
          call: runtimeCall,
          subscribe: runtimeSubscribe
        }
      }
    })
    seedRemoteWorkspace()
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
    replaceRuntimeEnvironmentRevisions([])
    resetWebSessionTabsSnapshotFreshnessForTests()
  })

  it('retires the bootstrap stream when the global batch contains the active worktree', async () => {
    const hook = renderHook(() => useWebSessionTabsSync())

    await waitFor(() => expect(runtimeSubscribe).toHaveBeenCalledTimes(2))
    await act(async () => {
      globalCallbacks?.onResponse(response({ type: 'snapshots', snapshots: [snapshot()] }))
    })

    await waitFor(() => expect(activeUnsubscribe).toHaveBeenCalledOnce())
    expect(runtimeSubscribe).toHaveBeenCalledTimes(2)
    expect(runtimeCall).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('uses one scoped list when a valid global batch omits the active worktree', async () => {
    const hook = renderHook(() => useWebSessionTabsSync())

    await waitFor(() => expect(globalCallbacks).toBeDefined())
    await act(async () => {
      globalCallbacks?.onResponse(response({ type: 'snapshots', snapshots: [] }))
    })

    await waitFor(() =>
      expect(runtimeCall).toHaveBeenCalledWith({
        selector: ENVIRONMENT_ID,
        method: 'session.tabs.list',
        params: { worktree: `id:${WORKTREE_ID}` },
        timeoutMs: 15_000,
        expectedEnvironmentPairingRevision: PAIRING_REVISION
      })
    )
    expect(runtimeSubscribe).toHaveBeenCalledTimes(2)
    expect(activeUnsubscribe).toHaveBeenCalledOnce()
    expect(
      runtimeCall.mock.calls.filter(([args]) => args.method === 'session.tabs.list')
    ).toHaveLength(1)
    hook.unmount()
  })

  it('re-lists an omitted active worktree after a global reconnect replay', async () => {
    const hook = renderHook(() => useWebSessionTabsSync())
    await waitFor(() => expect(globalCallbacks).toBeDefined())
    await act(async () =>
      globalCallbacks?.onResponse(response({ type: 'snapshots', snapshots: [] }))
    )
    await waitFor(() =>
      expect(
        runtimeCall.mock.calls.filter(([args]) => args.method === 'session.tabs.list')
      ).toHaveLength(1)
    )

    await act(async () =>
      globalCallbacks?.onResponse({
        ...response({ type: 'snapshots', snapshots: [] }),
        _replayedAfterReconnect: true
      } as unknown as RuntimeRpcResponse<unknown>)
    )
    await waitFor(() =>
      expect(
        runtimeCall.mock.calls.filter(([args]) => args.method === 'session.tabs.list')
      ).toHaveLength(2)
    )
    expect(runtimeSubscribe).toHaveBeenCalledTimes(2)
    hook.unmount()
  })

  it('routes later global updates through active wake recovery without a scoped stream', async () => {
    const hook = renderHook(() => useWebSessionTabsSync())
    await waitFor(() => expect(globalCallbacks).toBeDefined())
    await act(async () =>
      globalCallbacks?.onResponse(response({ type: 'snapshots', snapshots: [snapshot()] }))
    )
    useAppStore.setState({
      tabsByWorktree: {
        [WORKTREE_ID]: [
          {
            id: 'slept-tab',
            ptyId: null,
            worktreeId: WORKTREE_ID,
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
      globalCallbacks?.onResponse(
        response({ ...snapshot({ snapshotVersion: 2 }), type: 'updated' })
      )
    )

    await waitFor(() =>
      expect(runtimeCall.mock.calls.map(([args]) => args.method)).toContain(
        'session.tabs.createTerminal'
      )
    )
    expect(runtimeSubscribe).toHaveBeenCalledTimes(2)
    expect(activeUnsubscribe).toHaveBeenCalledOnce()
    hook.unmount()
  })

  it('retires a list-failure fallback after later global active evidence', async () => {
    runtimeCall.mockResolvedValueOnce({
      id: 'session.tabs.list',
      ok: false,
      error: { code: 'transport_closed', message: 'retry on the live stream' }
    })
    const hook = renderHook(() => useWebSessionTabsSync())
    await waitFor(() => expect(runtimeSubscribe).toHaveBeenCalledTimes(2))
    await act(async () =>
      globalCallbacks?.onResponse(response({ type: 'snapshots', snapshots: [] }))
    )
    await waitFor(() =>
      expect(
        runtimeSubscribe.mock.calls.filter(([args]) => args.method === 'session.tabs.subscribe')
      ).toHaveLength(2)
    )

    await act(async () =>
      globalCallbacks?.onResponse(
        response({ ...snapshot({ snapshotVersion: 2 }), type: 'updated' })
      )
    )
    await waitFor(() => expect(activeUnsubscribe).toHaveBeenCalledTimes(2))

    await act(async () =>
      globalCallbacks?.onResponse(
        response({ ...snapshot({ snapshotVersion: 3 }), type: 'updated' })
      )
    )
    expect(activeUnsubscribe).toHaveBeenCalledTimes(2)
    expect(runtimeSubscribe).toHaveBeenCalledTimes(3)
    hook.unmount()
  })

  it('fails open to scoped coverage when a replay comes from another runtime', async () => {
    const hook = renderHook(() => useWebSessionTabsSync())
    await waitFor(() => expect(runtimeSubscribe).toHaveBeenCalledTimes(2))
    await act(async () =>
      globalCallbacks?.onResponse(response({ type: 'snapshots', snapshots: [snapshot()] }))
    )
    await waitFor(() => expect(activeUnsubscribe).toHaveBeenCalledOnce())

    await act(async () =>
      globalCallbacks?.onResponse({
        ...response({ type: 'snapshots', snapshots: [snapshot({ snapshotVersion: 2 })] }),
        _meta: { runtimeId: 'restarted-pre-atomic-runtime' },
        _replayedAfterReconnect: true
      } as unknown as RuntimeRpcResponse<unknown>)
    )

    await waitFor(() =>
      expect(
        runtimeSubscribe.mock.calls.filter(([args]) => args.method === 'session.tabs.subscribe')
      ).toHaveLength(2)
    )
    expect(activeUnsubscribe).toHaveBeenCalledOnce()
    hook.unmount()
  })

  it('re-lists the same worktree after switching away and back', async () => {
    const hook = renderHook(() => useWebSessionTabsSync())
    await waitFor(() => expect(globalCallbacks).toBeDefined())
    await act(async () =>
      globalCallbacks?.onResponse(response({ type: 'snapshots', snapshots: [snapshot()] }))
    )

    await act(async () => {
      useAppStore.setState((state) => ({
        worktreesByRepo: { [REPO_ID]: [worktree(), worktree(SECOND_WORKTREE_ID)] },
        activeWorktreeId: SECOND_WORKTREE_ID,
        tabsByWorktree: {
          ...state.tabsByWorktree,
          [SECOND_WORKTREE_ID]: []
        }
      }))
    })
    await waitFor(() =>
      expect(
        runtimeCall.mock.calls.filter(
          ([args]) =>
            args.method === 'session.tabs.list' &&
            args.params.worktree === `id:${SECOND_WORKTREE_ID}`
        )
      ).toHaveLength(1)
    )

    runtimeCall.mockClear()
    await act(async () => {
      useAppStore.setState((state) => ({
        activeWorktreeId: WORKTREE_ID,
        tabsByWorktree: { ...state.tabsByWorktree, [WORKTREE_ID]: [] },
        ptyIdsByTabId: {}
      }))
    })

    await waitFor(() =>
      expect(
        runtimeCall.mock.calls.filter(
          ([args]) =>
            args.method === 'session.tabs.list' && args.params.worktree === `id:${WORKTREE_ID}`
        )
      ).toHaveLength(1)
    )
    expect(
      runtimeSubscribe.mock.calls.filter(([args]) => args.method === 'session.tabs.subscribe')
    ).toHaveLength(1)
    expect(activeUnsubscribe).toHaveBeenCalledOnce()
    hook.unmount()
  })
})
