import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type * as NodeCrypto from 'node:crypto'
import { SshRelaySession } from './ssh-relay-session'
import { createMockDeps, mockDeploySuccess } from './ssh-relay-session-test-fixtures'
import type { SshPtyConsumerAdmission } from './ssh-pty-consumer-session'

type MockMuxInstance = {
  requestHandlers: Map<string, (params: Record<string, unknown>) => Promise<unknown>>
  notify: ReturnType<typeof vi.fn>
}

const { acceptOutputExitMock, muxRequestMock, openConsumerSessionMock, muxInstancesRaw } =
  vi.hoisted(() => ({
    acceptOutputExitMock: vi.fn().mockResolvedValue(undefined),
    muxRequestMock: vi.fn(),
    openConsumerSessionMock: vi.fn(
      async (
        _mux: unknown,
        options: {
          clientInstanceId: string
          outputFlowControl?: unknown
          exactOperations?: unknown
          terminalAuthorityTopology?: unknown
        }
      ): Promise<SshPtyConsumerAdmission> => ({
        state: {
          mode: 'negotiated',
          clientInstanceId: options.clientInstanceId,
          clientGeneration: 1,
          ownerGeneration: 1,
          ownerLease: 'test-owner-lease',
          terminalAuthorityTopology: { version: 1 }
        },
        resumed: false
      })
    ),
    muxInstancesRaw: [] as unknown[]
  }))
const muxInstances = muxInstancesRaw as MockMuxInstance[]

vi.mock('./ssh-relay-deploy', () => ({ deployAndLaunchRelay: vi.fn() }))
vi.mock('./ssh-pty-consumer-session', () => ({
  openSshPtyConsumerSession: openConsumerSessionMock
}))
vi.mock('../ipc/ssh-pty-output-intake-registry', () => ({
  acceptSshPtyOutputData: vi.fn().mockResolvedValue(undefined),
  acceptSshPtyOutputExit: acceptOutputExitMock,
  allocateSshPtyProviderGeneration: vi.fn(() => 17),
  beginSshPtyOutputGenerationMigration: vi.fn(() => ({
    byPty: new Map(),
    completion: Promise.resolve()
  })),
  closeSshPtyOutputGeneration: vi.fn(),
  getSshPtyAcceptedSourceCheckpoints: vi.fn(() => []),
  applySshPtySourceRecoveryCancellationProof: vi.fn(() => true),
  installSshPtySourceAckPublisher: vi.fn(() => () => {}),
  installSshPtySourceCancellationPublisher: vi.fn(() => () => {})
}))
vi.mock('./ssh-relay-deploy-helpers', () => ({ execCommand: vi.fn().mockResolvedValue('') }))
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>()
  return { ...actual, randomUUID: vi.fn() }
})
vi.mock('./ssh-remote-orca-cli', () => ({
  runRemoteOrcaCli: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
}))
vi.mock('./ssh-channel-multiplexer', () => ({
  SshChannelMultiplexer: class MockSshChannelMultiplexer {
    requestHandlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>()
    notify = vi.fn()
    notifyWithSettlement = vi.fn()
    request = muxRequestMock
    onNotification = vi.fn().mockReturnValue(() => {})
    onNotificationByMethod = vi.fn().mockReturnValue(() => {})
    onRequest = vi.fn(
      (method: string, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
        this.requestHandlers.set(method, handler)
        return () => this.requestHandlers.delete(method)
      }
    )
    onDispose = vi.fn().mockReturnValue(() => {})
    dispose = vi.fn()
    isDisposed = vi.fn().mockReturnValue(false)

    constructor() {
      muxInstancesRaw.push(this)
    }
  }
}))
vi.mock('../agent-hooks/remote-managed-hook-installers', () => ({
  installRemoteManagedAgentHooks: vi.fn()
}))
vi.mock('../providers/ssh-pty-provider', () => ({
  isSshPtyNotFoundError: (error: unknown) => String(error).includes('not found'),
  isSshPtyIdentityMismatchError: (error: unknown) => String(error).includes('identity mismatch'),
  SshPtyProvider: class MockSshPtyProvider {
    onData = vi.fn().mockReturnValue(() => {})
    onReplay = vi.fn().mockReturnValue(() => {})
    onExit = vi.fn().mockReturnValue(() => {})
    attach = vi.fn().mockResolvedValue(undefined)
    attachForReconnect = vi.fn().mockResolvedValue({})
    dispose = vi.fn()
  }
}))
vi.mock('../providers/ssh-filesystem-provider', () => ({
  SshFilesystemProvider: class MockSshFilesystemProvider {
    dispose = vi.fn()
  }
}))
vi.mock('../providers/ssh-git-provider', () => ({
  SshGitProvider: class MockSshGitProvider {}
}))
vi.mock('../ipc/pty', () => ({
  waitForSshPtyPendingCloseReplay: vi.fn().mockResolvedValue(undefined),
  registerSshPtyProvider: vi.fn(),
  unregisterSshPtyProvider: vi.fn(),
  getSshPtyProvider: vi.fn(),
  getPtyIdsForConnection: vi.fn().mockReturnValue([]),
  clearPtyOwnershipForConnection: vi.fn(),
  clearProviderPtyState: vi.fn(),
  deletePtyOwnership: vi.fn(),
  setPtyOwnership: vi.fn(),
  restorePtyIncarnation: vi.fn(),
  isCurrentPtyExit: vi.fn(() => true),
  answerStartupTerminalColorQueriesForPty: vi.fn((_id: string, data: string) => data)
}))
vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  registerSshFilesystemProvider: vi.fn(),
  unregisterSshFilesystemProvider: vi.fn(),
  getSshFilesystemProvider: vi.fn().mockReturnValue({ dispose: vi.fn() })
}))
vi.mock('../providers/ssh-git-dispatch', () => ({
  registerSshGitProvider: vi.fn(),
  unregisterSshGitProvider: vi.fn()
}))

const {
  registerSshPtyProvider,
  unregisterSshPtyProvider,
  getSshPtyProvider,
  getPtyIdsForConnection,
  setPtyOwnership,
  restorePtyIncarnation
} = await import('../ipc/pty')
const { deployAndLaunchRelay } = await import('./ssh-relay-deploy')

const APP_PTY_ID = 'ssh:target-1@@pty-live'
const INCARNATION_LEAF_ID = '11111111-1111-4111-8111-111111111111'
let registeredPtyProvider: ReturnType<typeof getSshPtyProvider>

function detachedLease() {
  return {
    targetId: 'target-1',
    ptyId: 'pty-live',
    incarnationId: 'incarnation-from-lease',
    state: 'detached' as const,
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: INCARNATION_LEAF_ID,
    paneGeneration: 4
  }
}

function emitExitDuringAttach(payload: {
  id: string
  code: number
  incarnationId?: string
  providerGeneration?: number
  ptyIncarnation?: string
}): void {
  const registeredProvider = vi.mocked(registerSshPtyProvider).mock.calls[0]?.[1] as unknown as {
    onExit: ReturnType<typeof vi.fn>
  }
  const exitHandler = registeredProvider.onExit.mock.calls[0]?.[0] as
    | ((exit: typeof payload) => void)
    | undefined
  queueMicrotask(() =>
    exitHandler?.({
      providerGeneration: 17,
      ptyIncarnation: payload.incarnationId ?? `legacy:${payload.id}`,
      ...payload
    })
  )
}

describe('SshRelaySession reconnect incarnation ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    muxInstances.splice(0)
    delete process.env.ORCA_FEATURE_REMOTE_AGENT_HOOKS
    muxRequestMock.mockReset()
    muxRequestMock.mockResolvedValue([])
    vi.mocked(randomUUID).mockReset()
    vi.mocked(randomUUID).mockReturnValue('00000000-0000-4000-8000-000000000001')
    mockDeploySuccess()
    vi.mocked(getPtyIdsForConnection).mockReturnValue([])
    registeredPtyProvider = undefined
    vi.mocked(registerSshPtyProvider).mockImplementation((_targetId, provider) => {
      registeredPtyProvider = provider
    })
    vi.mocked(unregisterSshPtyProvider).mockImplementation(() => {
      registeredPtyProvider = undefined
    })
    vi.mocked(getSshPtyProvider).mockImplementation(() => registeredPtyProvider)
  })

  it('bounds fifty reattaches to eight workers without slow or failed sibling head-of-line delay', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    await session.establish(mockConn)
    vi.clearAllMocks()
    mockDeploySuccess()

    const ptyIds = Array.from({ length: 50 }, (_, index) => `pty-${index}`)
    let active = 0
    let peakActive = 0
    const attempts = new Map<string, number>()
    const mockAttach = vi.fn((id: string) => {
      attempts.set(id, (attempts.get(id) ?? 0) + 1)
      if (id === 'pty-0') {
        return new Promise<void>(() => {})
      }
      if (id === 'pty-1') {
        return Promise.reject(new Error('isolated attach failure'))
      }
      active++
      peakActive = Math.max(peakActive, active)
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          active--
          resolve()
        }, 100)
      })
    })
    vi.mocked(getSshPtyProvider).mockReturnValue({
      attachForReconnect: mockAttach,
      dispose: vi.fn()
    } as unknown as ReturnType<typeof getSshPtyProvider>)
    vi.mocked(getPtyIdsForConnection).mockReturnValue(ptyIds)
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.useFakeTimers()

    try {
      const reconnect = session.reconnect(mockConn)
      await vi.advanceTimersByTimeAsync(750)

      expect(setPtyOwnership).toHaveBeenCalledTimes(48)
      expect(mockStore.markSshRemotePtyLeasesAttachedAsync).not.toHaveBeenCalled()
      expect(peakActive).toBeLessThanOrEqual(8)

      await vi.advanceTimersByTimeAsync(20_000)
      await reconnect

      expect(mockAttach).toHaveBeenCalledTimes(52)
      expect(attempts.get('pty-0')).toBe(2)
      expect(attempts.get('pty-1')).toBe(2)
      expect(session.getState()).toBe('ready')
      expect(mockStore.markSshRemotePtyLeasesAttachedAsync).toHaveBeenCalledOnce()
      expect(mockStore.markSshRemotePtyLeasesAttachedAsync).toHaveBeenCalledWith(
        'target-1',
        expect.arrayContaining(ptyIds.slice(2))
      )
      expect(mockStore.markSshRemotePtyLease).not.toHaveBeenCalledWith(
        'target-1',
        expect.any(String),
        'expired'
      )
    } finally {
      vi.useRealTimers()
      random.mockRestore()
    }
  })

  it('offers source credit through reconnect', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)

    await session.establish(mockConn)
    await session.reconnect(mockConn)

    expect(deployAndLaunchRelay).toHaveBeenNthCalledWith(
      1,
      mockConn,
      undefined,
      undefined,
      'target-1'
    )
    expect(deployAndLaunchRelay).toHaveBeenNthCalledWith(
      2,
      mockConn,
      undefined,
      undefined,
      'target-1'
    )
    expect(openConsumerSessionMock).toHaveBeenCalledTimes(2)
    for (const [, options] of openConsumerSessionMock.mock.calls) {
      expect(options.outputFlowControl).toBeDefined()
      expect(options.exactOperations).toBe(true)
      expect(options.terminalAuthorityTopology).toBe(true)
    }
  })

  it('starts topology only for an exact namespace attached by authority resolution', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    const states: { kind: string }[] = []
    const namespace = { authorityHostId: 'test-authority-host', namespaceId: 'namespace-a' }
    const detach = session.attachResolvedNamespace(namespace, (state) => states.push(state))
    muxRequestMock.mockImplementation(
      async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
        if (method !== 'terminalAuthority.topologySnapshot') {
          return []
        }
        return {
          protocolVersion: 1,
          subscriptionId: params?.subscriptionId,
          streamIncarnationId: 'stream-a',
          namespace,
          writerEpoch: 1,
          authorityRevision: 0,
          appliedChangeSequence: 0,
          panes: [],
          namespaceRecoveryNotices: { version: 1, revision: 0, notices: [] }
        }
      }
    )

    await session.establish(mockConn)

    expect(states.at(-1)?.kind).toBe('authoritative')
    expect(muxRequestMock).toHaveBeenCalledWith(
      'terminalAuthority.topologySnapshot',
      expect.objectContaining({ namespace }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    detach()
    expect(muxInstances[0]?.notify).toHaveBeenCalledWith(
      'terminalAuthority.topologyUnsubscribe',
      expect.objectContaining({ namespace })
    )
  })

  it('keeps attached namespaces on legacy behavior when topology is not granted', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    const states: { kind: string }[] = []
    session.attachResolvedNamespace(
      { authorityHostId: 'test-authority-host', namespaceId: 'namespace-a' },
      (state) => states.push(state)
    )
    openConsumerSessionMock.mockResolvedValueOnce({
      state: {
        mode: 'negotiated',
        clientInstanceId: 'client-a',
        clientGeneration: 1,
        ownerGeneration: 1,
        ownerLease: 'owner-a'
      },
      resumed: false
    })

    await session.establish(mockConn)

    expect(states.at(-1)?.kind).toBe('legacy-fallback')
    expect(muxRequestMock).not.toHaveBeenCalledWith(
      'terminalAuthority.topologySnapshot',
      expect.anything(),
      expect.anything()
    )
  })

  it('keeps a committed namespace read-only when reconnecting to a peer without topology', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    const states: { kind: string; reason?: string }[] = []
    const namespace = { authorityHostId: 'test-authority-host', namespaceId: 'namespace-a' }
    session.attachResolvedNamespace(namespace, (state) => states.push(state))
    muxRequestMock.mockImplementation(
      async (method: string, params?: Record<string, unknown>): Promise<unknown> =>
        method === 'terminalAuthority.topologySnapshot'
          ? {
              protocolVersion: 1,
              subscriptionId: params?.subscriptionId,
              streamIncarnationId: 'stream-a',
              namespace,
              writerEpoch: 1,
              authorityRevision: 0,
              appliedChangeSequence: 0,
              panes: [],
              namespaceRecoveryNotices: { version: 1, revision: 0, notices: [] }
            }
          : []
    )
    await session.establish(mockConn)
    mockDeploySuccess()
    openConsumerSessionMock.mockResolvedValueOnce({
      state: {
        mode: 'negotiated',
        clientInstanceId: 'client-a',
        clientGeneration: 2,
        ownerGeneration: 1,
        ownerLease: 'owner-a'
      },
      resumed: false
    })

    await session.reconnect(mockConn)

    const committedIndex = states.findIndex((state) => state.kind === 'authoritative')
    expect(states.slice(committedIndex + 1)).toEqual([
      { kind: 'authority-unavailable', reason: 'disconnected' },
      { kind: 'authority-unavailable', reason: 'capability-not-granted' }
    ])
    expect(states.slice(committedIndex + 1).some((state) => state.kind === 'legacy-fallback')).toBe(
      false
    )
  })

  it('rolls back a timed-out activation that resolves after its replacement commits', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    await session.establish(mockConn)
    vi.clearAllMocks()
    mockDeploySuccess()
    const timedOutLease = { commit: vi.fn(), rollback: vi.fn() }
    const replacementLease = { commit: vi.fn(), rollback: vi.fn() }
    let resolveTimedOut!: (result: {
      incarnationId: string
      sourceActivationLease: typeof timedOutLease
    }) => void
    const mockAttach = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveTimedOut = resolve
        })
      )
      .mockResolvedValueOnce({
        incarnationId: 'incarnation-replacement',
        sourceActivationLease: replacementLease
      })
    vi.mocked(getSshPtyProvider).mockReturnValue({
      attachForReconnect: mockAttach,
      dispose: vi.fn()
    } as unknown as ReturnType<typeof getSshPtyProvider>)
    vi.mocked(getPtyIdsForConnection).mockReturnValue(['pty-1'])
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.useFakeTimers()

    try {
      const reconnect = session.reconnect(mockConn)
      await vi.advanceTimersByTimeAsync(11_000)
      await reconnect
      resolveTimedOut({
        incarnationId: 'incarnation-timed-out',
        sourceActivationLease: timedOutLease
      })
      await Promise.resolve()

      expect(replacementLease.commit).toHaveBeenCalledOnce()
      expect(replacementLease.rollback).not.toHaveBeenCalled()
      expect(timedOutLease.rollback).toHaveBeenCalledOnce()
      expect(timedOutLease.commit).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      random.mockRestore()
    }
  })

  it('keeps the winning reconnect incarnation when a stale health check resolves last', async () => {
    const consumerInstanceId = '00000000-0000-4000-8000-000000000000'
    const initialAttemptId = '00000000-0000-4000-8000-000000000010'
    const initialIncarnation = '00000000-0000-4000-8000-000000000001'
    const staleAttemptId = '00000000-0000-4000-8000-000000000011'
    const winningAttemptId = '00000000-0000-4000-8000-000000000012'
    const winningIncarnation = '00000000-0000-4000-8000-000000000002'
    const staleIncarnation = '00000000-0000-4000-8000-000000000003'
    let resolveStaleHealthCheck!: (value: unknown) => void
    const staleHealthCheck = new Promise((resolve) => {
      resolveStaleHealthCheck = resolve
    })
    let resolveHomeCalls = 0
    muxRequestMock.mockImplementation((method: string) => {
      if (method !== 'session.resolveHome') {
        return Promise.resolve([])
      }
      resolveHomeCalls += 1
      return resolveHomeCalls === 2 ? staleHealthCheck : Promise.resolve('/')
    })
    vi.mocked(randomUUID)
      .mockReturnValueOnce(consumerInstanceId)
      .mockReturnValueOnce(initialAttemptId)
      .mockReturnValueOnce(initialIncarnation)
      .mockReturnValueOnce(staleAttemptId)
      .mockReturnValueOnce(winningAttemptId)
      .mockReturnValueOnce(winningIncarnation)
      .mockReturnValue(staleIncarnation)
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const runtime = {
      registerOrchestrationCompatibilitySshAttachment: vi.fn(
        (_targetId: string, connectionIncarnation: string) => ({
          attachmentId: `attachment-${connectionIncarnation}`,
          connectionIncarnation
        })
      ),
      releaseOrchestrationCompatibilitySshAttachment: vi.fn()
    }
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )
    await session.establish(mockConn)

    const staleReconnect = session.reconnect(mockConn)
    await vi.waitFor(() => expect(resolveHomeCalls).toBe(2))
    await session.reconnect(mockConn)
    expect(session.getState()).toBe('ready')
    const winningMux = session.getMux() as unknown as MockMuxInstance

    resolveStaleHealthCheck('/')
    await staleReconnect

    expect(session.getMux()).toBe(winningMux)
    const winningCliHandler = winningMux.requestHandlers.get('orca.cli')
    expect(winningCliHandler).toBeDefined()
    await winningCliHandler?.({ argv: ['status'], cwd: '/', env: {} })

    expect(runtime.registerOrchestrationCompatibilitySshAttachment).toHaveBeenCalledWith(
      'target-1',
      winningIncarnation
    )
    expect(randomUUID).toHaveBeenCalledTimes(6)
  })

  it('restores and persists exact incarnation proof from reconnect attach', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const incarnationId = 'incarnation-reconnect'
    const attachForReconnect = vi.fn().mockResolvedValue({ incarnationId })
    vi.mocked(getSshPtyProvider).mockReturnValue({
      attachForReconnect,
      dispose: vi.fn()
    } as unknown as ReturnType<typeof getSshPtyProvider>)
    vi.mocked(mockStore.getSshRemotePtyLeases).mockReturnValue([detachedLease()] as ReturnType<
      typeof mockStore.getSshRemotePtyLeases
    >)
    const runtime = { onPtySpawned: vi.fn(), registerPty: vi.fn() }
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )

    await session.establish(mockConn)

    expect(attachForReconnect).toHaveBeenCalledWith('pty-live', {
      paneKey: `tab-1:${INCARNATION_LEAF_ID}`,
      tabId: 'tab-1',
      worktreeId: 'worktree-1',
      paneGeneration: 4,
      ptyIncarnationId: 'incarnation-from-lease'
    })
    expect(restorePtyIncarnation).toHaveBeenCalledWith(APP_PTY_ID, incarnationId)
    expect(runtime.registerPty).toHaveBeenCalledWith(APP_PTY_ID, 'worktree-1', 'target-1', {
      tabId: 'tab-1',
      leafId: INCARNATION_LEAF_ID,
      incarnationId
    })
    expect(runtime.onPtySpawned).not.toHaveBeenCalled()
    expect(mockStore.persistPtyBinding).toHaveBeenCalledWith({
      worktreeId: 'worktree-1',
      tabId: 'tab-1',
      leafId: INCARNATION_LEAF_ID,
      ptyId: APP_PTY_ID,
      incarnationId
    })
    expect(vi.mocked(mockStore.persistPtyBinding).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(mockStore.markSshRemotePtyLeasesAttachedAsync).mock.invocationCallOrder[0]!
    )
  })

  it('does not restore a PTY whose matching exit shares the attach reply batch', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow, mockWindow } = createMockDeps()
    const incarnationId = 'incarnation-exited-during-attach'
    const runtime = {
      acceptPtyIncarnationForExit: vi.fn(),
      onPtyExit: vi.fn(),
      onPtySpawned: vi.fn(),
      registerPty: vi.fn()
    }
    const sourceActivationLease = { commit: vi.fn(), rollback: vi.fn() }
    vi.mocked(getSshPtyProvider).mockReturnValue({
      attachForReconnect: vi.fn().mockImplementation(async () => {
        emitExitDuringAttach({ id: APP_PTY_ID, code: 0, incarnationId })
        emitExitDuringAttach({ id: APP_PTY_ID, code: 0, incarnationId: 'incarnation-stale' })
        return { incarnationId, replay: 'dead-output', sourceActivationLease }
      }),
      dispose: vi.fn()
    } as unknown as ReturnType<typeof getSshPtyProvider>)
    vi.mocked(mockStore.getSshRemotePtyLeases).mockReturnValue([detachedLease()] as ReturnType<
      typeof mockStore.getSshRemotePtyLeases
    >)
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )

    await session.establish(mockConn)

    expect(acceptOutputExitMock).toHaveBeenCalledWith({
      id: APP_PTY_ID,
      code: 0,
      providerGeneration: 17,
      ptyIncarnation: incarnationId
    })
    expect(runtime.onPtyExit).not.toHaveBeenCalled()
    expect(runtime.acceptPtyIncarnationForExit).toHaveBeenCalledWith(APP_PTY_ID, incarnationId)
    expect(runtime.registerPty).not.toHaveBeenCalled()
    expect(restorePtyIncarnation).toHaveBeenCalledWith(APP_PTY_ID, incarnationId)
    expect(setPtyOwnership).not.toHaveBeenCalled()
    expect(mockStore.persistPtyBinding).not.toHaveBeenCalled()
    expect(sourceActivationLease.rollback).toHaveBeenCalledOnce()
    expect(sourceActivationLease.commit).not.toHaveBeenCalled()
    expect(mockStore.markSshRemotePtyLease).toHaveBeenCalledWith(
      'target-1',
      'pty-live',
      'terminated'
    )
    expect(
      vi
        .mocked(mockWindow.webContents.send)
        .mock.calls.some(([channel]) => channel === 'pty:replay')
    ).toBe(false)
  })

  it('ignores an older incarnation exit while reconnecting a reused PTY id', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow, mockWindow } = createMockDeps()
    const currentIncarnationId = 'incarnation-current'
    const runtime = {
      acceptPtyIncarnationForExit: vi.fn(),
      onPtyExit: vi.fn(),
      onPtySpawned: vi.fn(),
      registerPty: vi.fn()
    }
    const sourceActivationLease = { commit: vi.fn(), rollback: vi.fn() }
    vi.mocked(getSshPtyProvider).mockReturnValue({
      attachForReconnect: vi.fn().mockImplementation(async () => {
        emitExitDuringAttach({
          id: APP_PTY_ID,
          code: 0,
          incarnationId: 'incarnation-old'
        })
        return { incarnationId: currentIncarnationId, replay: 'live-output', sourceActivationLease }
      }),
      dispose: vi.fn()
    } as unknown as ReturnType<typeof getSshPtyProvider>)
    vi.mocked(mockStore.getSshRemotePtyLeases).mockReturnValue([detachedLease()] as ReturnType<
      typeof mockStore.getSshRemotePtyLeases
    >)
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )

    await session.establish(mockConn)

    expect(runtime.onPtyExit).not.toHaveBeenCalled()
    expect(runtime.acceptPtyIncarnationForExit).not.toHaveBeenCalled()
    expect(sourceActivationLease.commit).toHaveBeenCalledOnce()
    expect(sourceActivationLease.rollback).not.toHaveBeenCalled()
    expect(runtime.registerPty).toHaveBeenCalledWith(APP_PTY_ID, 'worktree-1', 'target-1', {
      tabId: 'tab-1',
      leafId: INCARNATION_LEAF_ID,
      incarnationId: currentIncarnationId
    })
    expect(setPtyOwnership).toHaveBeenCalledWith(APP_PTY_ID, 'target-1')
    expect(mockStore.persistPtyBinding).toHaveBeenCalledWith(
      expect.objectContaining({ ptyId: APP_PTY_ID, incarnationId: currentIncarnationId })
    )
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('pty:replay', {
      id: APP_PTY_ID,
      data: 'live-output'
    })
  })

  it('keeps the attached PTY when incarnation backfill persistence fails', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const incarnationId = 'incarnation-reconnect'
    vi.mocked(getSshPtyProvider).mockReturnValue({
      attachForReconnect: vi.fn().mockResolvedValue({ incarnationId }),
      dispose: vi.fn()
    } as unknown as ReturnType<typeof getSshPtyProvider>)
    vi.mocked(mockStore.getSshRemotePtyLeases).mockReturnValue([detachedLease()] as ReturnType<
      typeof mockStore.getSshRemotePtyLeases
    >)
    vi.mocked(mockStore.persistPtyBinding).mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    const runtime = { onPtySpawned: vi.fn(), registerPty: vi.fn() }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )

    await expect(session.establish(mockConn)).resolves.toBeUndefined()

    expect(runtime.registerPty).toHaveBeenCalledWith(APP_PTY_ID, 'worktree-1', 'target-1', {
      tabId: 'tab-1',
      leafId: INCARNATION_LEAF_ID,
      incarnationId
    })
    expect(mockStore.markSshRemotePtyLeasesAttachedAsync).toHaveBeenCalledWith('target-1', [
      'pty-live'
    ])
    expect(consoleError).toHaveBeenCalledWith(
      '[ssh-relay-session] Failed to persist reconnect incarnation:',
      expect.any(Error)
    )
    consoleError.mockRestore()
  })
})
