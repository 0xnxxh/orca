import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import { hasPendingTerminalHandleRecoveryNeed } from './pending-terminal-handle-recovery'
import {
  MobileSessionTabsStreamHealth,
  type SessionTabsApplyOutcome
} from './mobile-session-tabs-stream-health'
import type { MobileSessionTab, SessionTabsResult } from './mobile-session-route-types'
import { acceptSessionSnapshot, type AppliedSnapshotMarker } from './session-tab-snapshot-gate'
import { useMobileSessionTabsReconciliation } from './use-mobile-session-tabs-reconciliation'

const TAB_ID = 'tab-1::f47ac10b-58cc-4372-a567-0e02b2c3d479'

function terminalTab(terminal: string | null): MobileSessionTab {
  return {
    type: 'terminal',
    id: TAB_ID,
    title: 'zsh',
    parentTabId: 'tab-1',
    leafId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    status: terminal === null ? 'pending-handle' : 'ready',
    terminal,
    isActive: true
  }
}

function snapshot(terminal: string | null, type?: 'snapshot' | 'updated'): SessionTabsResult {
  return {
    worktree: 'id:repo::worktree',
    publicationEpoch: 'host:1',
    snapshotVersion: 1,
    tabs: [terminalTab(terminal)],
    activeTabId: TAB_ID,
    activeTabType: 'terminal',
    ...(type ? { type } : {})
  } as SessionTabsResult
}

// Mirrors the route's applySessionTabs[worktreeId].tsx:1677-1832 contract: real
// acceptSessionSnapshot gating, active-tab derivation, revision tracking — so the
// real hasPendingTerminalHandleRecoveryNeed sees the same state the route would.
function makeRouteTabState() {
  const marker: AppliedSnapshotMarker = { epoch: null, version: 0 }
  const tabs: MobileSessionTab[] = []
  let activeTabId: string | null = null
  let applicationRevision = 0
  const apply = (result: SessionTabsResult): SessionTabsApplyOutcome<MobileSessionTab> => {
    if (!acceptSessionSnapshot(result, marker)) {
      return { accepted: false }
    }
    const snapshotActive = result.tabs.find((tab) => tab.isActive) ?? result.tabs[0] ?? null
    tabs.splice(0, tabs.length, ...result.tabs)
    activeTabId = snapshotActive?.id ?? null
    applicationRevision += 1
    return { accepted: true, effectiveTabs: result.tabs, applicationRevision }
  }
  return {
    apply,
    getApplicationRevision: () => applicationRevision,
    hasRecoveryNeed: () => hasPendingTerminalHandleRecoveryNeed(tabs, activeTabId)
  }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function expectEvenCadence(times: number[]): void {
  for (let i = 1; i < times.length; i += 1) {
    expect(times[i]! - times[i - 1]!).toBe(2000)
  }
}

function makeControllerHarness() {
  const route = makeRouteTabState()
  const requestTimes: number[] = []
  let materialized = false
  const sendRequest = vi.fn(async (): Promise<RpcSuccess> => {
    requestTimes.push(Date.now())
    return {
      id: `list-${requestTimes.length}`,
      ok: true as const,
      result: snapshot(materialized ? 'term-1' : null),
      _meta: { runtimeId: 'runtime-1' }
    }
  })
  const client = { sendRequest, getGeneration: () => 1 } as unknown as RpcClient
  const controller = new MobileSessionTabsStreamHealth<SessionTabsResult, MobileSessionTab>({
    client,
    scope: 'id:repo::worktree',
    apply: route.apply,
    consumeAccepted: () => {},
    hasRecoveryNeed: route.hasRecoveryNeed,
    getApplicationRevision: route.getApplicationRevision
  })
  return {
    client,
    controller,
    requestTimes,
    sendRequest,
    materialize: () => {
      materialized = true
    }
  }
}

const lifecycle = vi.hoisted(() => ({
  appState: 'active',
  focused: true,
  listeners: new Set<(state: string) => void>()
}))

vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return lifecycle.appState
    },
    addEventListener(_event: string, listener: (state: string) => void) {
      lifecycle.listeners.add(listener)
      return { remove: () => lifecycle.listeners.delete(listener) }
    }
  }
}))

vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    useFocusEffect(effect: () => void | (() => void)): void {
      React.useEffect(() => (lifecycle.focused ? effect() : undefined), [effect, lifecycle.focused])
    }
  }
})

function makeHookHarness() {
  const route = makeRouteTabState()
  const requestTimes: number[] = []
  const fetchTerminals = vi.fn(async () => {})
  const subscribe = vi.fn()
  const unsubscribe = vi.fn()
  let streamListener: ((payload: unknown) => void) | null = null
  let materialized = false
  const sendRequest = vi.fn(async (): Promise<RpcSuccess> => {
    requestTimes.push(Date.now())
    return {
      id: `list-${requestTimes.length}`,
      ok: true as const,
      result: snapshot(materialized ? 'term-1' : null),
      _meta: { runtimeId: 'runtime-1' }
    }
  })
  const client = { sendRequest, subscribe } as unknown as RpcClient
  subscribe.mockImplementation(
    (_method: string, _params: unknown, listener: (payload: unknown) => void) => {
      streamListener = listener
      return unsubscribe
    }
  )

  function Harness(): null {
    useMobileSessionTabsReconciliation<SessionTabsResult, MobileSessionTab>({
      client,
      connState: 'connected',
      worktreeId: 'repo::worktree',
      applySessionTabs: route.apply,
      consumeAcceptedSessionTabs: () => {},
      fetchTerminals,
      hasRecoveryNeed: route.hasRecoveryNeed,
      getApplicationRevision: route.getApplicationRevision
    })
    return null
  }
  return {
    Harness,
    fetchTerminals,
    materialize: () => {
      materialized = true
    },
    requestTimes,
    sendRequest,
    streamListener: () => streamListener
  }
}

describe('STA-4407: unbounded pending-handle poll (controller)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function certifyLive(harness: ReturnType<typeof makeControllerHarness>): Promise<void> {
    harness.controller.setReconciliationActive(true)
    const subscription = harness.controller.beginSubscription()
    subscription.listener(snapshot(null, 'snapshot'))
    await settle()
    subscription.listener(snapshot(null, 'updated'))
    await settle()
    expect(harness.controller.isCertified()).toBe(true)
    harness.sendRequest.mockClear()
    harness.requestTimes.length = 0
  }

  it('fires session.tabs.list every 2s for a full simulated hour with zero decay', async () => {
    const harness = makeControllerHarness()
    await certifyLive(harness)

    const interval = setInterval(() => harness.controller.poll(), 2000)
    await vi.advanceTimersByTimeAsync(3_600_000)
    clearInterval(interval)

    expect(harness.requestTimes).toHaveLength(1800)
    expect(harness.requestTimes[0]).toBe(2000)
    expect(harness.requestTimes[1799]).toBe(3_600_000)
    expectEvenCadence(harness.requestTimes)
    expect(harness.sendRequest).toHaveBeenCalledWith('session.tabs.list', {
      worktree: 'id:repo::worktree'
    })
  })

  it('parks the poll once a list response materializes the handle', async () => {
    const harness = makeControllerHarness()
    await certifyLive(harness)

    const interval = setInterval(() => harness.controller.poll(), 2000)
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(harness.requestTimes).toHaveLength(1800)

    harness.materialize()
    await vi.advanceTimersByTimeAsync(3_600_000)
    clearInterval(interval)

    // One extra request to learn the handle, then permanent silence.
    expect(harness.requestTimes).toHaveLength(1801)
    expect(harness.requestTimes[1800]).toBe(3_602_000)
  })
})

describe('STA-4407: unbounded pending-handle poll (hook wiring)', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    lifecycle.appState = 'active'
    lifecycle.focused = true
    lifecycle.listeners.clear()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  async function mount(harness: ReturnType<typeof makeHookHarness>): Promise<void> {
    await act(async () => {
      renderer = create(createElement(harness.Harness))
      await flush()
    })
  }

  async function emitStream(
    harness: ReturnType<typeof makeHookHarness>,
    payload: SessionTabsResult
  ): Promise<void> {
    await act(async () => {
      harness.streamListener()?.(payload)
      await flush()
    })
  }

  it('fires session.tabs.list every 2s for a full simulated hour with zero decay', async () => {
    const harness = makeHookHarness()
    await mount(harness)
    await emitStream(harness, snapshot(null, 'updated'))
    harness.sendRequest.mockClear()
    harness.fetchTerminals.mockClear()
    harness.requestTimes.length = 0

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000)
    })

    expect(harness.requestTimes).toHaveLength(1800)
    expect(harness.requestTimes[0]).toBe(2000)
    expect(harness.requestTimes[1799]).toBe(3_600_000)
    expectEvenCadence(harness.requestTimes)
    expect(harness.sendRequest).toHaveBeenCalledWith('session.tabs.list', {
      worktree: 'id:repo::worktree'
    })
    expect(harness.fetchTerminals).toHaveBeenCalledTimes(1800)
  })

  it('stops the cadence once a stream update materializes the handle', async () => {
    const harness = makeHookHarness()
    await mount(harness)
    await emitStream(harness, snapshot(null, 'updated'))
    harness.sendRequest.mockClear()
    harness.requestTimes.length = 0

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000)
    })
    expect(harness.requestTimes).toHaveLength(1800)

    await emitStream(harness, snapshot('term-1', 'updated'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000)
    })
    expect(harness.requestTimes).toHaveLength(1800)
  })

  it('parks immediately when the active terminal already has a handle', async () => {
    const harness = makeHookHarness()
    await mount(harness)
    await emitStream(harness, snapshot('term-1', 'updated'))
    harness.sendRequest.mockClear()
    harness.fetchTerminals.mockClear()
    harness.requestTimes.length = 0

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000)
    })

    expect(harness.requestTimes).toHaveLength(0)
    expect(harness.fetchTerminals).toHaveBeenCalledTimes(1800)
  })
})
