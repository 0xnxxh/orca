import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileRelayCredentialBundle } from './mobile-relay-credential-bundle'
import { RelayOuterError } from './mobile-relay-e2ee-link'
import type { MobileRelayRpcSession } from './mobile-relay-rpc-session'
import {
  MobileEndpointSupervisor,
  type MobileEndpointSupervisorDependencies
} from './mobile-endpoint-supervisor'
import type { RpcClient } from './rpc-client'
import type { MobileConnectionPath, StableLogicalRpcClient } from './stable-logical-rpc-client'
import type { ConnectionState, HostProfile, RpcResponse } from './types'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked' }))
vi.mock('expo-crypto', () => ({ getRandomBytes: (length: number) => new Uint8Array(length) }))

class FakeSession implements RpcClient {
  readonly sendRequest = vi.fn(
    async (_method: string, _params?: unknown): Promise<RpcResponse> => ({
      id: 'rpc-1',
      ok: true,
      result: {},
      _meta: { runtimeId: 'runtime-1' }
    })
  )
  readonly subscribe = vi.fn(() => () => {})
  readonly updateTerminalSubscriptionViewport = vi.fn()
  readonly notifyForeground = vi.fn()
  readonly close = vi.fn()
  private readonly listeners = new Set<(state: ConnectionState) => void>()

  constructor(private state: ConnectionState) {}

  getState = () => this.state
  getReconnectAttempt = () => 0
  getLastConnectedAt = () => null
  onStateChange = (listener: (state: ConnectionState) => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publishState(state: ConnectionState): void {
    this.state = state
    for (const listener of this.listeners) {
      listener(state)
    }
  }
}

class FakeRelaySession extends FakeSession implements MobileRelayRpcSession {
  constructor(
    state: ConnectionState,
    private readonly failure: Error | null = null
  ) {
    super(state)
  }
  getLeaseExpiresAt = () => Date.now() + 120_000
  getResumeConfirmation = () => null
  getFailure = () => this.failure
}

class FakeLogicalClient extends FakeSession implements StableLogicalRpcClient {
  private generation = 1

  constructor(
    state: ConnectionState,
    private path: MobileConnectionPath
  ) {
    super(state)
  }

  migrateTo = vi.fn(async (session: RpcClient, path: MobileConnectionPath) => {
    if (session.getState() !== 'connected') {
      session.close()
      throw new Error(`replacement session ${session.getState()}`)
    }
    this.path = path
    this.generation += 1
    this.publishState('connected')
  })
  suspendActiveSession = vi.fn(() => this.publishState('disconnected'))
  getActivePath = () => this.path
  getGeneration = () => this.generation
}

const relay = {
  v: 1 as const,
  directorUrl: 'https://relay.onorca.dev',
  cellUrl: 'https://relay-c1.onorca.dev',
  assignmentEpoch: 7,
  relayHostId: 'AbCdEf0123_-xyZ9',
  e2eeFraming: 2 as const
}
const host: HostProfile = {
  id: 'host-1',
  name: 'Blue Whale',
  endpoint: 'ws://192.168.1.10:6768',
  deviceToken: 'device-token',
  publicKeyB64: 'A'.repeat(44),
  lastConnected: 1,
  relayHostId: relay.relayHostId,
  relay
}
const bundle: MobileRelayCredentialBundle = {
  v: 1,
  hostId: host.id,
  deviceToken: host.deviceToken,
  current: {
    token: 'A'.repeat(43),
    hash: 'B'.repeat(43),
    version: 2,
    expiresAt: Number.MAX_SAFE_INTEGER
  }
}

function dependencies(
  overrides: Partial<MobileEndpointSupervisorDependencies> = {}
): MobileEndpointSupervisorDependencies {
  return {
    openDirect: vi.fn(() => new FakeSession('connected')),
    openRelay: vi.fn(() => new FakeRelaySession('connected')),
    resolveRelay: vi.fn(async ({ relay }) => relay),
    readBundle: vi.fn(async () => bundle),
    writeBundle: vi.fn(async () => {}),
    saveHost: vi.fn(async () => {}),
    now: Date.now,
    randomBytes: (length) => new Uint8Array(length).fill(1),
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    ...overrides
  }
}

function mockCredentialRotation(logical: FakeLogicalClient): void {
  let installed: Record<string, unknown> | null = null
  logical.sendRequest.mockImplementation(async (method, params) => {
    const request = params as { installReqId?: string; reqId?: string }
    if (method === 'pairing.provisionRelay') {
      installed = {
        v: 1,
        reqId: request.reqId,
        authorizationMode: 'authenticated-direct',
        currentVersion: 3,
        resumeExpiresAt: Date.now() + 300_000,
        graceExpiresAt: Date.now() + 60_000
      }
      return { id: 'rpc-2', ok: true, result: installed, _meta: { runtimeId: 'runtime-1' } }
    }
    return {
      id: 'rpc-1',
      ok: true,
      result: {
        v: 1,
        relay,
        installStatus: installed
          ? { v: 1, reqId: request.installReqId, state: 'committed', result: installed }
          : { v: 1, reqId: request.installReqId, state: 'not-found' }
      },
      _meta: { runtimeId: 'runtime-1' }
    }
  })
}

describe('mobile endpoint supervisor retirement', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T12:00:00Z'))
  })

  afterEach(() => vi.useRealTimers())

  it('does not publish a resolved relay profile after stopping', async () => {
    const logical = new FakeLogicalClient('disconnected', 'lan')
    let finishResolve: ((value: typeof relay) => void) | undefined
    const resolvePending = new Promise<typeof relay>((resolve) => {
      finishResolve = resolve
    })
    const onHostUpdated = vi.fn()
    const deps = dependencies({
      openRelay: vi.fn(() => new FakeRelaySession('disconnected', new RelayOuterError(4409))),
      resolveRelay: vi.fn(() => resolvePending),
      onHostUpdated
    })
    const supervisor = new MobileEndpointSupervisor(logical, host, deps)

    const starting = supervisor.start()
    await vi.waitFor(() => expect(deps.resolveRelay).toHaveBeenCalledOnce())
    supervisor.stop()
    finishResolve?.(relay)
    await starting

    expect(deps.saveHost).not.toHaveBeenCalled()
    expect(onHostUpdated).not.toHaveBeenCalled()
  })

  it('does not publish a rotated relay profile after stopping', async () => {
    const logical = new FakeLogicalClient('connected', 'lan')
    let finishCredentialWrite: (() => void) | undefined
    const credentialWritePending = new Promise<void>((resolve) => {
      finishCredentialWrite = resolve
    })
    const writeBundle = vi
      .fn<(value: MobileRelayCredentialBundle) => Promise<void>>()
      .mockResolvedValue()
      .mockResolvedValueOnce()
      .mockReturnValueOnce(credentialWritePending)
    const onHostUpdated = vi.fn()
    mockCredentialRotation(logical)
    const deps = dependencies({ writeBundle, onHostUpdated })
    const supervisor = new MobileEndpointSupervisor(logical, host, deps)

    await supervisor.start()
    logical.publishState('connected')
    await vi.waitFor(() => expect(writeBundle).toHaveBeenCalledTimes(2))
    supervisor.stop()
    finishCredentialWrite?.()
    await vi.advanceTimersByTimeAsync(0)

    expect(deps.saveHost).not.toHaveBeenCalled()
    expect(onHostUpdated).not.toHaveBeenCalled()
  })
})
