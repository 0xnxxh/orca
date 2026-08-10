import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'

const mocks = vi.hoisted(() => ({
  state: {
    tabsByWorktree: {} as Record<string, { id: string }[]>,
    ptyIdsByTabId: {} as Record<string, string[]>
  },
  acceptReplay: vi.fn(),
  applySnapshot: vi.fn(() => ({ applied: true })),
  applySnapshots: vi.fn(() => ({ applied: true })),
  applyStorePatch: vi.fn((build: (state: unknown) => unknown) => build(mocks.state)),
  shouldApply: vi.fn(() => true),
  shouldBootstrap: vi.fn((_args: { requestedInitialTerminal: boolean }) => false),
  shouldWake: vi.fn(() => false),
  createTerminal: vi.fn(async () => undefined),
  beginWake: vi.fn(() => true),
  endWake: vi.fn(),
  skipWake: vi.fn(() => false),
  recover: vi.fn(async (_state: unknown, snapshot: RuntimeMobileSessionTabsResult) => snapshot)
}))

vi.mock('../store', () => ({
  useAppStore: { getState: () => mocks.state }
}))
vi.mock('./web-session-tabs-sync', () => ({
  acceptReplayedWebSessionTabsSnapshot: mocks.acceptReplay,
  applyWebSessionTabsSnapshot: mocks.applySnapshot,
  applyWebSessionTabsSnapshots: mocks.applySnapshots,
  applyWebSessionTabsStorePatch: mocks.applyStorePatch,
  shouldApplyWebSessionTabsSnapshot: mocks.shouldApply,
  shouldBootstrapInitialWebRuntimeTerminal: mocks.shouldBootstrap,
  shouldRespawnWebRuntimeTerminalAfterWake: mocks.shouldWake
}))
vi.mock('./web-runtime-session', () => ({
  createWebRuntimeSessionTerminal: mocks.createTerminal
}))
vi.mock('./web-runtime-wake-terminal-respawn', () => ({
  beginWebRuntimeWakeTerminalRespawn: mocks.beginWake,
  endWebRuntimeWakeTerminalRespawn: mocks.endWake,
  shouldSkipWebRuntimeWakeTerminalRespawn: mocks.skipWake
}))
vi.mock('./web-session-terminal-orphan-recovery', () => ({
  recoverWebSessionTerminalOrphansBeforeApply: mocks.recover
}))

import {
  type ActiveSessionTabsContext,
  recoverAndApplyWebSessionTabsSnapshots
} from './web-session-tabs-active-snapshot'

const ENV = 'env-1'
const WT = 'repo::worktree'
const TARGET = 'env-1\u0001runtime-1\u00011\u00017'

function snapshot(version = 1): RuntimeMobileSessionTabsResult {
  return {
    worktree: WT,
    publicationEpoch: 'epoch-1',
    snapshotVersion: version,
    activeGroupId: null,
    activeTabId: null,
    activeTabType: null,
    tabs: []
  }
}

function context(): ActiveSessionTabsContext {
  return {
    targetKey: TARGET,
    environmentId: ENV,
    pairingRevision: 7,
    supportsAtomicGlobalSubscription: true,
    worktreeId: WT,
    requestedInitialTerminal: false,
    requestedRespawnAfterWake: false
  }
}

function process(
  active: { current: ActiveSessionTabsContext | null },
  options: { acceptCurrent?: boolean; isCurrent?: () => boolean; version?: number } = {}
): Promise<ActiveSessionTabsContext | null> {
  return recoverAndApplyWebSessionTabsSnapshots({
    environmentId: ENV,
    targetKey: TARGET,
    snapshots: [{ snapshot: snapshot(options.version), type: 'snapshot' }],
    replayed: false,
    acceptCurrent: options.acceptCurrent ?? false,
    activeContextRef: active,
    isCurrent: options.isCurrent ?? (() => true)
  })
}

describe('active web session snapshot processing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.shouldApply.mockReturnValue(true)
    mocks.shouldBootstrap.mockReturnValue(false)
    mocks.shouldWake.mockReturnValue(false)
    mocks.beginWake.mockReturnValue(true)
    mocks.recover.mockImplementation(async (_state, value) => value)
  })

  it('grants exact-current replay after recovery and before freshness', async () => {
    const active: { current: ActiveSessionTabsContext | null } = { current: context() }
    await process(active, { acceptCurrent: true })

    expect(mocks.acceptReplay).toHaveBeenCalledWith(ENV, WT)
    expect(mocks.acceptReplay.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.shouldApply.mock.invocationCallOrder[0]
    )
    expect(mocks.applySnapshot).toHaveBeenCalledTimes(1)
  })

  it('ignores a recovered result after its active owner becomes stale', async () => {
    let resolveRecovery: (value: RuntimeMobileSessionTabsResult) => void = () => {}
    mocks.recover.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRecovery = resolve
      })
    )
    let current = true
    const active: { current: ActiveSessionTabsContext | null } = { current: context() }
    const pending = process(active, { acceptCurrent: true, isCurrent: () => current })
    current = false
    active.current = null
    resolveRecovery(snapshot())

    await expect(pending).resolves.toBeNull()
    expect(mocks.acceptReplay).not.toHaveBeenCalled()
    expect(mocks.shouldApply).not.toHaveBeenCalled()
    expect(mocks.createTerminal).not.toHaveBeenCalled()
  })

  it('shares the wake lock with activation before requesting bootstrap', async () => {
    const activeContext = context()
    const active = { current: activeContext }
    mocks.shouldBootstrap.mockImplementation(
      ({ requestedInitialTerminal }) => !requestedInitialTerminal
    )
    mocks.beginWake.mockReturnValueOnce(false).mockReturnValue(true)

    await process(active)
    expect(mocks.createTerminal).not.toHaveBeenCalled()
    expect(activeContext.requestedInitialTerminal).toBe(false)

    await process(active, { version: 2 })
    await process(active, { version: 3 })
    expect(mocks.createTerminal).toHaveBeenCalledTimes(1)
    expect(activeContext.requestedInitialTerminal).toBe(true)
    expect(mocks.endWake).toHaveBeenCalledTimes(1)
  })

  it('uses non-selecting terminal recovery for later wake updates', async () => {
    const active = { current: context() }
    mocks.shouldWake.mockReturnValue(true)

    await recoverAndApplyWebSessionTabsSnapshots({
      environmentId: ENV,
      targetKey: TARGET,
      snapshots: [{ snapshot: snapshot(), type: 'updated' }],
      replayed: false,
      acceptCurrent: false,
      activeContextRef: active,
      isCurrent: () => true
    })

    expect(mocks.createTerminal).toHaveBeenCalledWith({
      worktreeId: WT,
      environmentId: ENV,
      activate: true,
      selectWorktree: false
    })
  })
})
