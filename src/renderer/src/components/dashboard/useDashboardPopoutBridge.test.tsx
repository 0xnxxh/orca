// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acknowledgeAgents: vi.fn(),
  setActiveWorktree: vi.fn(),
  subscribeStore: vi.fn(() => vi.fn()),
  onRevealAgent: vi.fn(),
  onAckAgent: vi.fn(),
  onPopoutOpenChanged: vi.fn(),
  onSnapshotRequested: vi.fn(),
  getPopoutOpen: vi.fn(async () => false),
  publishSnapshot: vi.fn(async () => undefined),
  offRevealAgent: vi.fn(),
  offAckAgent: vi.fn(),
  offPopoutOpenChanged: vi.fn(),
  offSnapshotRequested: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      acknowledgeAgents: mocks.acknowledgeAgents,
      setActiveWorktree: mocks.setActiveWorktree
    }),
    subscribe: mocks.subscribeStore
  }
}))

vi.mock('@/lib/activate-tab-and-focus-pane', () => ({
  activateTabAndFocusPane: vi.fn()
}))

import {
  dashboardSnapshotInputsChanged,
  useDashboardPopoutBridge
} from './useDashboardPopoutBridge'
import type { DashboardSnapshotState } from './build-dashboard-snapshot'
import type { AppState } from '@/store/types'

type DashboardSnapshotWatchState = DashboardSnapshotState & Pick<AppState, 'agentStatusEpoch'>

function makeSnapshotWatchState(): DashboardSnapshotWatchState {
  return {
    repos: [],
    worktreesByRepo: {},
    tabsByWorktree: {},
    agentStatusByPaneKey: {},
    retainedAgentsByPaneKey: {},
    migrationUnsupportedByPtyId: {},
    runtimeAgentOrchestrationByPaneKey: {},
    terminalLayoutsByTabId: {},
    ptyIdsByTabId: {},
    runtimePaneTitlesByTabId: {},
    acknowledgedAgentsByPaneKey: {},
    settings: null,
    agentStatusEpoch: 0,
    // Why: seeded with real identities so the profile assertions below compare
    // two distinct values — omitting them would pass against `undefined`.
    sshConnectionStates: new Map(),
    sshStateByEnvironment: new Map(),
    runtimeStatusByEnvironmentId: new Map(),
    paneForegroundAgentByPaneKey: {},
    detectedWorktreesByRepo: {},
    folderWorkspaces: [],
    projectGroups: [],
    restoredRuntimeHostIdByWorkspaceSessionKey: {},
    runtimeEnvironments: [],
    runtimeEnvironmentCatalogHydrated: false,
    removedRuntimeEnvironmentIds: new Set()
  } as DashboardSnapshotWatchState
}

function Harness({ enabled }: { enabled: boolean }): null {
  useDashboardPopoutBridge(enabled)
  return null
}

describe('useDashboardPopoutBridge', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.onRevealAgent.mockReturnValue(mocks.offRevealAgent)
    mocks.onAckAgent.mockReturnValue(mocks.offAckAgent)
    mocks.onPopoutOpenChanged.mockReturnValue(mocks.offPopoutOpenChanged)
    mocks.onSnapshotRequested.mockReturnValue(mocks.offSnapshotRequested)
    ;(window as unknown as { api: unknown }).api = {
      dashboard: {
        onRevealAgent: mocks.onRevealAgent,
        onAckAgent: mocks.onAckAgent,
        onPopoutOpenChanged: mocks.onPopoutOpenChanged,
        onSnapshotRequested: mocks.onSnapshotRequested,
        getPopoutOpen: mocks.getPopoutOpen,
        publishSnapshot: mocks.publishSnapshot
      }
    }
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
  })

  it('does not register dashboard or store subscriptions while disabled', async () => {
    await act(async () => root.render(<Harness enabled={false} />))

    expect(mocks.onRevealAgent).not.toHaveBeenCalled()
    expect(mocks.onAckAgent).not.toHaveBeenCalled()
    expect(mocks.onPopoutOpenChanged).not.toHaveBeenCalled()
    expect(mocks.onSnapshotRequested).not.toHaveBeenCalled()
    expect(mocks.getPopoutOpen).not.toHaveBeenCalled()
    expect(mocks.subscribeStore).not.toHaveBeenCalled()
  })

  it('ignores unrelated store writes while retaining every snapshot input', () => {
    const previousState = makeSnapshotWatchState()
    expect(dashboardSnapshotInputsChanged({ ...previousState }, previousState)).toBe(false)

    const referenceInputs = [
      'repos',
      'worktreesByRepo',
      'tabsByWorktree',
      'agentStatusByPaneKey',
      'retainedAgentsByPaneKey',
      'migrationUnsupportedByPtyId',
      'runtimeAgentOrchestrationByPaneKey',
      'terminalLayoutsByTabId',
      'ptyIdsByTabId',
      'runtimePaneTitlesByTabId',
      'acknowledgedAgentsByPaneKey'
    ] as const
    for (const key of referenceInputs) {
      expect(
        dashboardSnapshotInputsChanged({ ...previousState, [key]: {} }, previousState),
        key
      ).toBe(true)
    }
    expect(
      dashboardSnapshotInputsChanged({ ...previousState, agentStatusEpoch: 1 }, previousState)
    ).toBe(true)

    // Why: each card's preview terminal keys against a host-input profile
    // derived from these. Not republishing leaves the pop-out encoding bytes
    // for the host the pty used to run on.
    const profileInputs: Partial<DashboardSnapshotWatchState>[] = [
      { sshConnectionStates: new Map() },
      { sshStateByEnvironment: new Map() },
      { runtimeStatusByEnvironmentId: new Map() },
      { paneForegroundAgentByPaneKey: {} },
      { detectedWorktreesByRepo: {} },
      // A folder workspace is not a git worktree; its host resolves through these.
      { folderWorkspaces: [] },
      { projectGroups: [] },
      { restoredRuntimeHostIdByWorkspaceSessionKey: {} },
      { runtimeEnvironments: [] },
      { runtimeEnvironmentCatalogHydrated: true },
      { removedRuntimeEnvironmentIds: new Set() }
    ]
    const republished = profileInputs
      .filter((next) =>
        dashboardSnapshotInputsChanged({ ...previousState, ...next }, previousState)
      )
      .map((next) => Object.keys(next)[0])
    expect(republished).toEqual(profileInputs.map((next) => Object.keys(next)[0]))
  })

  it('releases every dashboard listener when the experiment is disabled', async () => {
    await act(async () => root.render(<Harness enabled />))

    expect(mocks.onRevealAgent).toHaveBeenCalledTimes(1)
    expect(mocks.onAckAgent).toHaveBeenCalledTimes(1)
    expect(mocks.onPopoutOpenChanged).toHaveBeenCalledTimes(1)
    expect(mocks.onSnapshotRequested).toHaveBeenCalledTimes(1)
    expect(mocks.getPopoutOpen).toHaveBeenCalledTimes(1)

    await act(async () => root.render(<Harness enabled={false} />))

    expect(mocks.offRevealAgent).toHaveBeenCalledTimes(1)
    expect(mocks.offAckAgent).toHaveBeenCalledTimes(1)
    expect(mocks.offPopoutOpenChanged).toHaveBeenCalledTimes(1)
    expect(mocks.offSnapshotRequested).toHaveBeenCalledTimes(1)
  })
})
