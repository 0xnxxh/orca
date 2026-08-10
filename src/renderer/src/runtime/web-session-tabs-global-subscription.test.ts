// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicKnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import type { ActiveSessionTabsContext } from './web-session-tabs-active-snapshot'
import { replaceRuntimeEnvironmentRevisions } from './runtime-environment-revision'

const mocks = vi.hoisted(() => ({
  recover: vi.fn()
}))

vi.mock('./web-session-tabs-active-snapshot', () => ({
  recoverAndApplyWebSessionTabsSnapshots: mocks.recover
}))

import { startGlobalWebSessionTabsSubscription } from './web-session-tabs-global-subscription'

const ENVIRONMENT_ID = 'remote-env'
const RUNTIME_ID = 'remote-runtime'
const PAIRING_REVISION = 17
type SubscribeCallbacks = Parameters<typeof window.api.runtimeEnvironments.subscribe>[1]

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
      { id: 'endpoint', kind: 'websocket', label: 'WebSocket', endpoint: 'ws://remote.invalid' }
    ],
    preferredEndpointId: 'endpoint'
  }
}

function response(result: unknown): RuntimeRpcResponse<unknown> {
  return { id: 'subscribe-all', ok: true, result, _meta: { runtimeId: RUNTIME_ID } }
}

function snapshot(version: number): RuntimeMobileSessionTabsResult {
  return {
    worktree: 'repo::worktree',
    publicationEpoch: 'epoch-1',
    snapshotVersion: version,
    activeGroupId: null,
    activeTabId: null,
    activeTabType: null,
    tabs: []
  }
}

function deferred<T = null>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function activeContext(worktreeId = 'repo::worktree'): ActiveSessionTabsContext {
  return {
    targetKey: 'target-1',
    environmentId: ENVIRONMENT_ID,
    pairingRevision: PAIRING_REVISION,
    supportsAtomicGlobalSubscription: true,
    worktreeId,
    requestedInitialTerminal: false,
    requestedRespawnAfterWake: false
  }
}

describe('global web session tabs subscription', () => {
  const unsubscribe = vi.fn()
  let callbacks: SubscribeCallbacks | undefined

  beforeEach(() => {
    callbacks = undefined
    mocks.recover.mockReset()
    unsubscribe.mockReset()
    replaceRuntimeEnvironmentRevisions([environment()])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: {
          call: vi.fn(),
          subscribe: vi.fn(async (_args, nextCallbacks: SubscribeCallbacks) => {
            callbacks = nextCallbacks
            return { unsubscribe, sendBinary: vi.fn() }
          })
        }
      }
    })
  })

  afterEach(() => {
    replaceRuntimeEnvironmentRevisions([])
  })

  it('does not restore ready coverage after the stream closes during initial recovery', async () => {
    const recovery = deferred()
    mocks.recover.mockReturnValue(recovery.promise)
    const onCoverage = vi.fn()
    const stop = startGlobalWebSessionTabsSubscription({
      environmentId: ENVIRONMENT_ID,
      targetKey: 'target-1',
      expectedRuntimeId: RUNTIME_ID,
      expectedEnvironmentPairingRevision: PAIRING_REVISION,
      activeContextRef: { current: null },
      onCoverage
    })
    await vi.waitFor(() => expect(callbacks).toBeDefined())

    callbacks?.onResponse(response({ type: 'snapshots', snapshots: [] }))
    await vi.waitFor(() => expect(mocks.recover).toHaveBeenCalledOnce())

    callbacks?.onClose?.()
    expect(onCoverage).toHaveBeenCalledExactlyOnceWith({ status: 'unavailable' })

    recovery.resolve(null)
    await recovery.promise
    await Promise.resolve()
    expect(onCoverage).toHaveBeenCalledExactlyOnceWith({ status: 'unavailable' })
    stop()
  })

  it('publishes ready coverage only for the latest reconnect recovery', async () => {
    const first = deferred()
    const second = deferred()
    mocks.recover.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const onCoverage = vi.fn()
    const stop = startGlobalWebSessionTabsSubscription({
      environmentId: ENVIRONMENT_ID,
      targetKey: 'target-1',
      expectedRuntimeId: RUNTIME_ID,
      expectedEnvironmentPairingRevision: PAIRING_REVISION,
      activeContextRef: { current: null },
      onCoverage
    })
    await vi.waitFor(() => expect(callbacks).toBeDefined())

    callbacks?.onResponse(response({ type: 'snapshots', snapshots: [] }))
    callbacks?.onResponse(response({ type: 'snapshots', snapshots: [] }))
    await vi.waitFor(() => expect(mocks.recover).toHaveBeenCalledTimes(2))

    first.resolve(null)
    await first.promise
    await Promise.resolve()
    expect(onCoverage).not.toHaveBeenCalled()

    second.resolve(null)
    await second.promise
    await vi.waitFor(() =>
      expect(onCoverage).toHaveBeenCalledExactlyOnceWith({
        status: 'ready',
        servicedActiveContext: null
      })
    )
    stop()
  })

  it('retains active evidence that recovers before the initial batch', async () => {
    const initialRecovery = deferred()
    const context = activeContext()
    mocks.recover.mockReturnValueOnce(initialRecovery.promise).mockResolvedValueOnce(context)
    const onCoverage = vi.fn()
    const stop = startGlobalWebSessionTabsSubscription({
      environmentId: ENVIRONMENT_ID,
      targetKey: 'target-1',
      expectedRuntimeId: RUNTIME_ID,
      expectedEnvironmentPairingRevision: PAIRING_REVISION,
      activeContextRef: { current: context },
      onCoverage
    })
    await vi.waitFor(() => expect(callbacks).toBeDefined())

    callbacks?.onResponse(response({ type: 'snapshots', snapshots: [] }))
    callbacks?.onResponse(response({ ...snapshot(1), type: 'updated' }))
    await vi.waitFor(() => expect(mocks.recover).toHaveBeenCalledTimes(2))
    expect(onCoverage).not.toHaveBeenCalled()

    initialRecovery.resolve(null)
    await initialRecovery.promise
    await vi.waitFor(() =>
      expect(onCoverage).toHaveBeenCalledExactlyOnceWith({
        status: 'ready',
        servicedActiveContext: context
      })
    )
    stop()
  })

  it('does not let stale activation recovery replace pending current evidence', async () => {
    const initialRecovery = deferred()
    const staleRecovery = deferred<ActiveSessionTabsContext>()
    const currentRecovery = deferred<ActiveSessionTabsContext>()
    const staleContext = activeContext('repo::stale')
    const currentContext = activeContext('repo::current')
    const activeContextRef: { current: ActiveSessionTabsContext | null } = {
      current: staleContext
    }
    mocks.recover
      .mockReturnValueOnce(initialRecovery.promise)
      .mockReturnValueOnce(staleRecovery.promise)
      .mockReturnValueOnce(currentRecovery.promise)
    const onCoverage = vi.fn()
    const stop = startGlobalWebSessionTabsSubscription({
      environmentId: ENVIRONMENT_ID,
      targetKey: 'target-1',
      expectedRuntimeId: RUNTIME_ID,
      expectedEnvironmentPairingRevision: PAIRING_REVISION,
      activeContextRef,
      onCoverage
    })
    await vi.waitFor(() => expect(callbacks).toBeDefined())

    callbacks?.onResponse(response({ type: 'snapshots', snapshots: [] }))
    callbacks?.onResponse(
      response({ ...snapshot(1), worktree: staleContext.worktreeId, type: 'updated' })
    )
    activeContextRef.current = currentContext
    callbacks?.onResponse(
      response({ ...snapshot(2), worktree: currentContext.worktreeId, type: 'updated' })
    )
    await vi.waitFor(() => expect(mocks.recover).toHaveBeenCalledTimes(3))

    currentRecovery.resolve(currentContext)
    await currentRecovery.promise
    await Promise.resolve()
    staleRecovery.resolve(staleContext)
    await staleRecovery.promise
    await Promise.resolve()
    initialRecovery.resolve(null)
    await initialRecovery.promise

    await vi.waitFor(() =>
      expect(onCoverage).toHaveBeenCalledExactlyOnceWith({
        status: 'ready',
        servicedActiveContext: currentContext
      })
    )
    stop()
  })
})
