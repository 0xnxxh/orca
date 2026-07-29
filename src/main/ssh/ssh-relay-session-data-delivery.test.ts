import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PTY_CONSUMER_STALE_OWNER_RECOVERY_ERROR } from '../../shared/pty-consumer-session'
import { SshRelaySession } from './ssh-relay-session'
import { createMockDeps, mockDeploySuccess } from './ssh-relay-session-test-fixtures'

const {
  acceptOutputDataMock,
  muxRequestMock,
  onNotificationByMethodMock,
  notifyWithSettlementMock,
  openConsumerSessionMock,
  pauseAdapterMock,
  muxDisposeMock,
  attachForReconnectMock,
  ptyDataHandlerRef
} = vi.hoisted(() => ({
  acceptOutputDataMock: vi.fn().mockResolvedValue(undefined),
  muxRequestMock: vi.fn(),
  onNotificationByMethodMock: vi.fn(),
  notifyWithSettlementMock: vi.fn(),
  openConsumerSessionMock: vi.fn(),
  pauseAdapterMock: vi.fn(),
  muxDisposeMock: vi.fn(),
  attachForReconnectMock: vi.fn().mockResolvedValue({}),
  ptyDataHandlerRef: { current: undefined as undefined | ((payload: unknown) => void) }
}))

vi.mock('./ssh-relay-deploy', () => ({ deployAndLaunchRelay: vi.fn() }))
vi.mock('./ssh-pty-consumer-session', () => ({
  openSshPtyConsumerSession: openConsumerSessionMock
}))
vi.mock('../ipc/ssh-pty-output-intake-registry', () => ({
  acceptSshPtyOutputData: acceptOutputDataMock,
  acceptSshPtyOutputExit: vi.fn().mockResolvedValue(undefined),
  allocateSshPtyProviderGeneration: vi.fn(() => 23),
  closeSshPtyOutputGeneration: vi.fn(),
  getSshPtyAcceptedSourceCheckpoints: vi.fn(() => []),
  installSshPtySourceAckPublisher: vi.fn(() => () => {}),
  installSshPtySourceCancellationPublisher: vi.fn(() => () => {}),
  applySshPtySourceCancellationProof: vi.fn()
}))

vi.mock('./ssh-channel-multiplexer', () => ({
  SshChannelMultiplexer: class MockSshChannelMultiplexer {
    notify = vi.fn()
    notifyWithSettlement = notifyWithSettlementMock
    request = muxRequestMock
    onNotification = vi.fn().mockReturnValue(() => {})
    onNotificationByMethod = onNotificationByMethodMock.mockImplementation(() => () => {})
    onRequest = vi.fn().mockReturnValue(() => {})
    onDispose = vi.fn().mockReturnValue(() => {})
    dispose = muxDisposeMock
    isDisposed = vi.fn().mockReturnValue(false)
  }
}))

vi.mock('../agent-hooks/remote-managed-hook-installers', () => ({
  installRemoteManagedAgentHooks: vi.fn().mockResolvedValue([])
}))

vi.mock('../providers/ssh-pty-provider', () => ({
  isSshPtyNotFoundError: vi.fn().mockReturnValue(false),
  isSshPtyIdentityMismatchError: vi.fn().mockReturnValue(false),
  SshPtyProvider: class MockSshPtyProvider {
    onData = vi.fn().mockImplementation((handler) => {
      ptyDataHandlerRef.current = handler
      return () => {}
    })
    onReplay = vi.fn().mockReturnValue(() => {})
    onExit = vi.fn().mockReturnValue(() => {})
    attach = vi.fn().mockResolvedValue(undefined)
    attachForReconnect = attachForReconnectMock
    setPtyDeliveryPauseAdapter = pauseAdapterMock
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
  registerSshPtyProvider: vi.fn(),
  unregisterSshPtyProvider: vi.fn(),
  getSshPtyProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  getPtyIdsForConnection: vi.fn().mockReturnValue([]),
  clearPtyOwnershipForConnection: vi.fn(),
  clearProviderPtyState: vi.fn(),
  deletePtyOwnership: vi.fn(),
  restorePtyIncarnation: vi.fn(),
  setPtyOwnership: vi.fn()
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
  clearProviderPtyState,
  clearPtyOwnershipForConnection,
  deletePtyOwnership,
  getSshPtyProvider,
  getPtyIdsForConnection,
  registerSshPtyProvider,
  setPtyOwnership
} = await import('../ipc/pty')
const { closeSshPtyOutputGeneration } = await import('../ipc/ssh-pty-output-intake-registry')
const { applySshPtySourceCancellationProof } = await import('../ipc/ssh-pty-output-intake-registry')
const { getSshPtyAcceptedSourceCheckpoints } = await import('../ipc/ssh-pty-output-intake-registry')
const { installSshPtySourceAckPublisher } = await import('../ipc/ssh-pty-output-intake-registry')
const { deployAndLaunchRelay } = await import('./ssh-relay-deploy')

describe('SshRelaySession data delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ptyDataHandlerRef.current = undefined
    attachForReconnectMock.mockResolvedValue({})
    vi.mocked(getPtyIdsForConnection).mockReturnValue([])
    vi.mocked(getSshPtyAcceptedSourceCheckpoints).mockReturnValue([])
    vi.mocked(applySshPtySourceCancellationProof).mockReturnValue(true)
    openConsumerSessionMock.mockImplementation(async (_mux, options) => ({
      mode: 'negotiated',
      clientInstanceId: options.clientInstanceId,
      clientGeneration: 1,
      ownerGeneration: 1,
      ownerLease: 'test-owner-lease',
      ...(options.outputFlowControl
        ? {
            outputFlowControl: { version: 1, windowSu: options.outputFlowControl.requestedWindowSu }
          }
        : {})
    }))
    muxRequestMock.mockResolvedValue([])
    mockDeploySuccess()
  })

  async function runRecoverySequence(args: {
    targetId: string
    recoveryEndSu: number
    recoveryFrame?: readonly [startSu: number, endSu: number]
    liveFrame?: readonly [startSu: number, endSu: number]
  }) {
    muxRequestMock.mockImplementation(async (method) =>
      method === 'pty.cancelDelivery'
        ? { canceled: true, sentEndSu: args.recoveryEndSu, creditedEndSu: 4 }
        : []
    )
    let generation = 0
    openConsumerSessionMock.mockImplementation(async (_mux, options) => ({
      mode: 'negotiated',
      clientInstanceId: options.clientInstanceId,
      clientGeneration: ++generation,
      ownerGeneration: generation,
      ownerLease: `owner-lease-${generation}`,
      outputFlowControl: { version: 1, windowSu: 256 * 1024 }
    }))
    vi.mocked(getSshPtyAcceptedSourceCheckpoints).mockReturnValue([
      {
        id: `ssh:${args.targetId}@@pty-1`,
        providerGeneration: 23,
        clientGeneration: 1,
        ownerGeneration: 1,
        ptyIncarnation: 'incarnation-1',
        deliveryToken: 'old-token',
        acceptedSourceEndSu: 4
      }
    ])
    const deps = createMockDeps()
    const session = new SshRelaySession(
      args.targetId,
      deps.getMainWindow,
      deps.mockStore,
      deps.mockPortForward,
      undefined,
      undefined,
      () => true
    )
    await session.establish(deps.mockConn)
    vi.mocked(getPtyIdsForConnection).mockReturnValue([`ssh:${args.targetId}@@pty-1`])
    vi.mocked(getSshPtyProvider).mockImplementation(
      () => vi.mocked(registerSshPtyProvider).mock.calls.at(-1)?.[1]
    )
    attachForReconnectMock.mockImplementation(async () => {
      queueMicrotask(() => {
        if (args.recoveryFrame) {
          const [sourceStartSu, sourceEndSu] = args.recoveryFrame
          ptyDataHandlerRef.current?.({
            id: `ssh:${args.targetId}@@pty-1`,
            data: 'recovery',
            providerGeneration: 23,
            ptyIncarnation: 'incarnation-1',
            sequenceChars: sourceEndSu - sourceStartSu,
            source: {
              relayPtyId: 'pty-1',
              spanId: `new-token:${sourceStartSu}:${sourceEndSu}`,
              clientGeneration: 2,
              ownerGeneration: 2,
              deliveryToken: 'new-token',
              sourceStartSu,
              sourceEndSu
            }
          })
        }
        const complete = onNotificationByMethodMock.mock.calls.findLast(
          ([method]) => method === 'pty.recoveryComplete'
        )?.[1] as ((params: Record<string, unknown>) => void) | undefined
        complete?.({
          id: 'pty-1',
          clientGeneration: 2,
          ownerGeneration: 2,
          ptyIncarnation: 'incarnation-1',
          deliveryToken: 'new-token',
          checkpointSourceEndSu: 4,
          recoveryEndSu: args.recoveryEndSu
        })
        if (args.liveFrame) {
          const [sourceStartSu, sourceEndSu] = args.liveFrame
          ptyDataHandlerRef.current?.({
            id: `ssh:${args.targetId}@@pty-1`,
            data: 'live',
            providerGeneration: 23,
            ptyIncarnation: 'incarnation-1',
            sequenceChars: sourceEndSu - sourceStartSu,
            source: {
              relayPtyId: 'pty-1',
              spanId: `new-token:${sourceStartSu}:${sourceEndSu}`,
              clientGeneration: 2,
              ownerGeneration: 2,
              deliveryToken: 'new-token',
              sourceStartSu,
              sourceEndSu
            }
          })
        }
      })
      return {
        incarnationId: 'incarnation-1',
        sourceRecovery: {
          status: 'pending',
          clientGeneration: 2,
          ownerGeneration: 2,
          ptyIncarnation: 'incarnation-1',
          deliveryToken: 'new-token',
          checkpointSourceEndSu: 4,
          recoveryEndSu: args.recoveryEndSu
        }
      }
    })
    await session.reconnect(deps.mockConn)
    return { ...deps, session }
  }

  it('transfers negotiated owner recovery exactly once across an explicit detach', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    vi.mocked(deployAndLaunchRelay).mockResolvedValue({
      transport: { write: vi.fn(), onData: vi.fn(), onClose: vi.fn() },
      platform: 'linux-x64',
      serverBuildId: 'test-relay-build'
    })
    const first = new SshRelaySession('recovery-target', getMainWindow, mockStore, mockPortForward)

    await first.establish(mockConn)
    first.detach()
    const second = new SshRelaySession('recovery-target', getMainWindow, mockStore, mockPortForward)
    await second.establish(mockConn)

    const firstOpen = openConsumerSessionMock.mock.calls[0]?.[1]
    const recoveredOpen = openConsumerSessionMock.mock.calls[1]?.[1]
    expect(recoveredOpen).toMatchObject({
      clientInstanceId: firstOpen.clientInstanceId,
      resume: { ownerGeneration: 1, ownerLease: 'test-owner-lease' }
    })

    second.dispose()
    const fresh = new SshRelaySession('recovery-target', getMainWindow, mockStore, mockPortForward)
    await fresh.establish(mockConn)
    const freshOpen = openConsumerSessionMock.mock.calls[2]?.[1]
    expect(freshOpen.clientInstanceId).not.toBe(firstOpen.clientInstanceId)
    expect(freshOpen).not.toHaveProperty('resume')
    fresh.dispose()
  })

  it('clears stale owner recovery and retries a fresh same-build relay once without resume', async () => {
    const targetId = 'fresh-relay-retry'
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    vi.mocked(deployAndLaunchRelay).mockResolvedValue({
      transport: { write: vi.fn(), onData: vi.fn(), onClose: vi.fn() },
      platform: 'linux-x64',
      serverBuildId: 'test-relay-build'
    })
    vi.mocked(getSshPtyAcceptedSourceCheckpoints).mockReturnValue([
      {
        id: `ssh:${targetId}@@pty-1`,
        providerGeneration: 23,
        clientGeneration: 1,
        ownerGeneration: 1,
        ptyIncarnation: 'incarnation-1',
        deliveryToken: 'old-token',
        acceptedSourceEndSu: 4
      }
    ])
    const first = new SshRelaySession(
      targetId,
      getMainWindow,
      mockStore,
      mockPortForward,
      undefined,
      undefined,
      () => true
    )
    await first.establish(mockConn)
    first.detach()

    openConsumerSessionMock
      .mockRejectedValueOnce(
        Object.assign(new Error('Owner recovery lease is stale'), {
          code: PTY_CONSUMER_STALE_OWNER_RECOVERY_ERROR
        })
      )
      .mockImplementationOnce(async (_mux, options) => ({
        mode: 'negotiated',
        clientInstanceId: options.clientInstanceId,
        clientGeneration: 1,
        ownerGeneration: 1,
        ownerLease: 'fresh-owner-lease',
        outputFlowControl: { version: 1, windowSu: 256 * 1024 }
      }))
    vi.mocked(getPtyIdsForConnection).mockReturnValue([`ssh:${targetId}@@pty-1`])
    vi.mocked(getSshPtyProvider).mockImplementation(
      () => vi.mocked(registerSshPtyProvider).mock.calls.at(-1)?.[1]
    )
    attachForReconnectMock.mockResolvedValue({
      incarnationId: 'incarnation-1',
      sourceRecovery: { status: 'restoreRequired', reason: 'checkpointUnavailable' }
    })
    const second = new SshRelaySession(
      targetId,
      getMainWindow,
      mockStore,
      mockPortForward,
      undefined,
      undefined,
      () => true
    )
    const openCallCountBeforeRetry = openConsumerSessionMock.mock.calls.length

    await second.establish(mockConn)

    const retryCalls = openConsumerSessionMock.mock.calls
      .slice(openCallCountBeforeRetry)
      .map(([, options]) => options)
    expect(retryCalls).toHaveLength(2)
    expect(retryCalls[0]).toHaveProperty('resume')
    expect(retryCalls[1]).not.toHaveProperty('resume')
    expect(attachForReconnectMock).toHaveBeenCalledWith(
      'pty-1',
      undefined,
      Object.freeze({ status: 'checkpointUnavailable' })
    )
    second.dispose()
  })

  it('delivers empty transformed relay spans with raw sequence metadata', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow, mockWindow } = createMockDeps()
    const runtime = { onPtyData: vi.fn(() => 17), onPtyExit: vi.fn() }
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )
    await session.establish(mockConn)
    const ptyProvider = vi.mocked(registerSshPtyProvider).mock.calls[0]?.[1] as unknown as {
      onData: ReturnType<typeof vi.fn>
    }
    const onData = ptyProvider.onData.mock.calls[0]?.[0] as (payload: {
      id: string
      data: string
      sequenceChars?: number
      transformed?: boolean
      providerGeneration: number
      ptyIncarnation: string
    }) => void

    onData({
      id: 'ssh-pty-1',
      data: '',
      sequenceChars: 9,
      transformed: true,
      providerGeneration: 23,
      ptyIncarnation: 'incarnation-1'
    })

    expect(acceptOutputDataMock).toHaveBeenCalledWith({
      id: 'ssh-pty-1',
      data: '',
      providerGeneration: 23,
      ptyIncarnation: 'incarnation-1',
      rawLength: 9,
      transformed: true
    })
    expect(runtime.onPtyData).not.toHaveBeenCalled()
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('pty:data', expect.anything())
  })

  it('forwards negotiated source identity to the bounded intake exactly once', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      undefined,
      undefined,
      () => true
    )
    await session.establish(mockConn)
    const ptyProvider = vi.mocked(registerSshPtyProvider).mock.calls[0]?.[1] as unknown as {
      onData: ReturnType<typeof vi.fn>
    }
    const onData = ptyProvider.onData.mock.calls[0]?.[0] as (payload: {
      id: string
      data: string
      providerGeneration: number
      ptyIncarnation: string
      source: {
        relayPtyId: string
        spanId: string
        clientGeneration: number
        ownerGeneration: number
        deliveryToken: string
        sourceStartSu: number
        sourceEndSu: number
      }
    }) => void
    const source = {
      relayPtyId: 'pty-1',
      spanId: 'token-1:0:4',
      clientGeneration: 1,
      ownerGeneration: 1,
      deliveryToken: 'token-1',
      sourceStartSu: 0,
      sourceEndSu: 4
    }

    onData({
      id: 'ssh-pty-1',
      data: 'data',
      providerGeneration: 23,
      ptyIncarnation: 'incarnation-1',
      source
    })

    expect(acceptOutputDataMock).toHaveBeenCalledOnce()
    expect(acceptOutputDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ssh-pty-1', rawLength: 4, source })
    )
  })

  it('rejects missing negotiated source identity before main admission', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      undefined,
      undefined,
      () => true
    )
    await session.establish(mockConn)
    const provider = vi.mocked(registerSshPtyProvider).mock.calls[0]?.[1] as unknown as {
      onData: ReturnType<typeof vi.fn>
    }
    const onData = provider.onData.mock.calls[0]?.[0] as (payload: Record<string, unknown>) => void

    onData({
      id: 'ssh-pty-1',
      data: 'data',
      providerGeneration: 23,
      ptyIncarnation: 'incarnation-1'
    })

    expect(acceptOutputDataMock).not.toHaveBeenCalled()
    expect(closeSshPtyOutputGeneration).toHaveBeenCalledWith(
      23,
      'ssh_source_frame_malformed_or_missing'
    )
  })

  it('keeps unoffered source metadata out of legacy intake', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    await session.establish(mockConn)
    const provider = vi.mocked(registerSshPtyProvider).mock.calls[0]?.[1] as unknown as {
      onData: ReturnType<typeof vi.fn>
    }
    const onData = provider.onData.mock.calls[0]?.[0] as (payload: Record<string, unknown>) => void

    onData({
      id: 'ssh-pty-1',
      data: 'data',
      providerGeneration: 23,
      ptyIncarnation: 'incarnation-1',
      source: {
        relayPtyId: 'pty-1',
        spanId: 'token-1:0:4',
        clientGeneration: 1,
        ownerGeneration: 1,
        deliveryToken: 'token-1',
        sourceStartSu: 0,
        sourceEndSu: 4
      }
    })

    expect(acceptOutputDataMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ source: expect.anything() })
    )
  })

  it('keeps same-build method-not-found fallback token-free', async () => {
    openConsumerSessionMock.mockImplementationOnce(async (_mux, options) => ({
      mode: 'legacy-fallback',
      clientInstanceId: options.clientInstanceId,
      serverBuildId: 'test-relay-build'
    }))
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)

    await session.establish(mockConn)

    expect(session.getState()).toBe('ready')
    expect(pauseAdapterMock).not.toHaveBeenCalled()
    expect(openConsumerSessionMock.mock.calls[0][1]).not.toHaveProperty('outputFlowControl')
    expect(installSshPtySourceAckPublisher).not.toHaveBeenCalled()
  })

  it('publishes negotiated ACK batches through mux settlement', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      undefined,
      undefined,
      () => true
    )
    await session.establish(mockConn)
    const publish = vi.mocked(installSshPtySourceAckPublisher).mock.calls[0]?.[1]
    const settled = vi.fn()
    const batch = {
      acknowledgements: [
        {
          id: 'pty-1',
          clientGeneration: 1,
          ownerGeneration: 1,
          deliveryToken: 'token-1',
          creditedEndSu: 4
        }
      ]
    }

    publish?.(batch, settled)

    expect(openConsumerSessionMock.mock.calls[0][1]).toMatchObject({
      outputFlowControl: { requestedWindowSu: 256 * 1024 }
    })
    expect(deployAndLaunchRelay).toHaveBeenCalledWith(
      mockConn,
      undefined,
      undefined,
      'target-1',
      true
    )
    expect(notifyWithSettlementMock).toHaveBeenCalledWith('pty.ackData', batch, settled)
  })

  it('applies the V1 kill switch to reconnect negotiation', async () => {
    let enabled = true
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      undefined,
      undefined,
      () => enabled
    )
    await session.establish(mockConn)
    enabled = false

    await session.reconnect(mockConn)

    expect(openConsumerSessionMock.mock.calls[0][1]).toHaveProperty('outputFlowControl')
    expect(openConsumerSessionMock.mock.calls[1][1]).not.toHaveProperty('outputFlowControl')
    expect(deployAndLaunchRelay).toHaveBeenNthCalledWith(
      1,
      mockConn,
      undefined,
      undefined,
      'target-1',
      true
    )
    expect(deployAndLaunchRelay).toHaveBeenNthCalledWith(
      2,
      mockConn,
      undefined,
      undefined,
      'target-1',
      false
    )
  })

  it('reattaches V1 from an exact checkpoint and quarantines live data until recoveryComplete', async () => {
    let generation = 0
    openConsumerSessionMock.mockImplementation(async (_mux, options) => {
      generation++
      return {
        mode: 'negotiated',
        clientInstanceId: options.clientInstanceId,
        clientGeneration: generation,
        ownerGeneration: generation,
        ownerLease: `owner-lease-${generation}`,
        outputFlowControl: { version: 1, windowSu: 256 * 1024 }
      }
    })
    vi.mocked(getSshPtyAcceptedSourceCheckpoints).mockReturnValue([
      {
        id: 'ssh:target-1@@pty-1',
        providerGeneration: 23,
        clientGeneration: 1,
        ownerGeneration: 1,
        ptyIncarnation: 'incarnation-1',
        deliveryToken: 'old-token',
        acceptedSourceEndSu: 4
      }
    ])
    const { mockConn, mockStore, mockPortForward, getMainWindow, mockWindow } = createMockDeps()
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      undefined,
      undefined,
      () => true
    )
    await session.establish(mockConn)
    vi.mocked(getPtyIdsForConnection).mockReturnValue(['ssh:target-1@@pty-1'])
    vi.mocked(getSshPtyProvider).mockImplementation(
      () => vi.mocked(registerSshPtyProvider).mock.calls.at(-1)?.[1]
    )
    let transferDisposedMux = false
    attachForReconnectMock.mockImplementation(async () => {
      const canceled = onNotificationByMethodMock.mock.calls.findLast(
        ([method]) => method === 'pty.deliveryCanceled'
      )?.[1] as ((params: Record<string, unknown>) => void) | undefined
      const disposeCount = muxDisposeMock.mock.calls.length
      canceled?.({
        id: 'pty-1',
        clientGeneration: 1,
        ownerGeneration: 1,
        ptyIncarnation: 'incarnation-1',
        deliveryToken: 'old-token',
        replacementDeliveryToken: 'new-token'
      })
      transferDisposedMux = muxDisposeMock.mock.calls.length !== disposeCount
      queueMicrotask(() => {
        ptyDataHandlerRef.current?.({
          id: 'ssh:target-1@@pty-1',
          data: 're',
          providerGeneration: 23,
          ptyIncarnation: 'incarnation-1',
          sequenceChars: 2,
          source: {
            relayPtyId: 'pty-1',
            spanId: 'new-token:4:6',
            clientGeneration: 2,
            ownerGeneration: 2,
            deliveryToken: 'new-token',
            sourceStartSu: 4,
            sourceEndSu: 6
          }
        })
        ptyDataHandlerRef.current?.({
          id: 'ssh:target-1@@pty-1',
          data: 'co',
          providerGeneration: 23,
          ptyIncarnation: 'incarnation-1',
          sequenceChars: 2,
          source: {
            relayPtyId: 'pty-1',
            spanId: 'new-token:6:8',
            clientGeneration: 2,
            ownerGeneration: 2,
            deliveryToken: 'new-token',
            sourceStartSu: 6,
            sourceEndSu: 8
          }
        })
        const complete = onNotificationByMethodMock.mock.calls.findLast(
          ([method]) => method === 'pty.recoveryComplete'
        )?.[1] as ((params: Record<string, unknown>) => void) | undefined
        complete?.({
          id: 'pty-1',
          clientGeneration: 2,
          ownerGeneration: 2,
          ptyIncarnation: 'incarnation-1',
          deliveryToken: 'new-token',
          checkpointSourceEndSu: 4,
          recoveryEndSu: 8
        })
        ptyDataHandlerRef.current?.({
          id: 'ssh:target-1@@pty-1',
          data: 'live',
          providerGeneration: 23,
          ptyIncarnation: 'incarnation-1',
          sequenceChars: 4,
          source: {
            relayPtyId: 'pty-1',
            spanId: 'new-token:8:12',
            clientGeneration: 2,
            ownerGeneration: 2,
            deliveryToken: 'new-token',
            sourceStartSu: 8,
            sourceEndSu: 12
          }
        })
      })
      return {
        incarnationId: 'incarnation-1',
        sourceRecovery: {
          status: 'pending',
          clientGeneration: 2,
          ownerGeneration: 2,
          ptyIncarnation: 'incarnation-1',
          deliveryToken: 'new-token',
          checkpointSourceEndSu: 4,
          recoveryEndSu: 8
        }
      }
    })

    await session.reconnect(mockConn)

    expect(attachForReconnectMock).toHaveBeenCalledWith(
      'pty-1',
      undefined,
      expect.objectContaining({
        status: 'checkpoint',
        deliveryToken: 'old-token',
        acceptedSourceEndSu: 4
      })
    )
    expect(acceptOutputDataMock.mock.calls.map(([payload]) => payload.data)).toEqual([
      're',
      'co',
      'live'
    ])
    expect(transferDisposedMux).toBe(false)
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('pty:replay', expect.anything())

    const closeCount = vi.mocked(closeSshPtyOutputGeneration).mock.calls.length
    const canceled = onNotificationByMethodMock.mock.calls.findLast(
      ([method]) => method === 'pty.deliveryCanceled'
    )?.[1] as ((params: Record<string, unknown>) => void) | undefined
    canceled?.({
      id: 'pty-1',
      clientGeneration: 1,
      ownerGeneration: 1,
      ptyIncarnation: 'incarnation-1',
      deliveryToken: 'old-token'
    })
    expect(closeSshPtyOutputGeneration).toHaveBeenCalledTimes(closeCount)
  })

  it.each([
    ['gap', [5, 8] as const],
    ['overlap', [3, 8] as const],
    ['incomplete suffix', [4, 6] as const],
    ['missing body', undefined]
  ])('rejects %s recovery without destroying the physical PTY or lease', async (label, frame) => {
    const targetId = `invalid-recovery-${label.replace(' ', '-')}`
    const { mockStore, mockWindow } = await runRecoverySequence({
      targetId,
      recoveryEndSu: 8,
      ...(frame ? { recoveryFrame: frame } : {})
    })

    expect(acceptOutputDataMock).not.toHaveBeenCalled()
    expect(muxRequestMock).toHaveBeenCalledWith('pty.cancelDelivery', {
      id: 'pty-1',
      clientGeneration: 2,
      ownerGeneration: 2,
      deliveryToken: 'new-token'
    })
    expect(applySshPtySourceCancellationProof).toHaveBeenCalledWith(
      {
        id: `ssh:${targetId}@@pty-1`,
        code: -1,
        providerGeneration: 23,
        ptyIncarnation: 'incarnation-1'
      },
      { sentEndSu: 8, creditedEndSu: 4 }
    )
    expect(mockStore.markSshRemotePtyLease).toHaveBeenCalledWith(targetId, 'pty-1', 'detached')
    expect(mockStore.markSshRemotePtyLease).not.toHaveBeenCalledWith(targetId, 'pty-1', 'expired')
    expect(mockStore.markSshRemotePtyLeases).not.toHaveBeenCalled()
    expect(clearProviderPtyState).not.toHaveBeenCalled()
    expect(clearPtyOwnershipForConnection).not.toHaveBeenCalled()
    expect(deletePtyOwnership).not.toHaveBeenCalled()
    expect(setPtyOwnership).not.toHaveBeenCalled()
    expect(muxDisposeMock).not.toHaveBeenCalledWith('shutdown')
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('pty:exit', expect.anything())
  })

  it('accepts empty recovery only when the checkpoint equals the recovery end', async () => {
    const { mockStore } = await runRecoverySequence({
      targetId: 'empty-recovery',
      recoveryEndSu: 4,
      liveFrame: [4, 8]
    })

    expect(acceptOutputDataMock.mock.calls.map(([payload]) => payload.data)).toEqual(['live'])
    expect(mockStore.markSshRemotePtyLease).toHaveBeenCalledWith(
      'empty-recovery',
      'pty-1',
      'attached'
    )
  })
})
