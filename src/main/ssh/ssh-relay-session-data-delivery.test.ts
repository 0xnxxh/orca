import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SshRelaySession } from './ssh-relay-session'
import { createMockDeps, mockDeploySuccess } from './ssh-relay-session-test-fixtures'

const {
  acceptOutputDataMock,
  muxRequestMock,
  notifyWithSettlementMock,
  openConsumerSessionMock,
  pauseAdapterMock
} = vi.hoisted(() => ({
  acceptOutputDataMock: vi.fn().mockResolvedValue(undefined),
  muxRequestMock: vi.fn(),
  notifyWithSettlementMock: vi.fn(),
  openConsumerSessionMock: vi.fn(),
  pauseAdapterMock: vi.fn()
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
  installSshPtySourceAckPublisher: vi.fn(() => () => {})
}))

vi.mock('./ssh-channel-multiplexer', () => ({
  SshChannelMultiplexer: class MockSshChannelMultiplexer {
    notify = vi.fn()
    notifyWithSettlement = notifyWithSettlementMock
    request = muxRequestMock
    onNotification = vi.fn().mockReturnValue(() => {})
    onRequest = vi.fn().mockReturnValue(() => {})
    onDispose = vi.fn().mockReturnValue(() => {})
    dispose = vi.fn()
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
    onData = vi.fn().mockReturnValue(() => {})
    onReplay = vi.fn().mockReturnValue(() => {})
    onExit = vi.fn().mockReturnValue(() => {})
    attach = vi.fn().mockResolvedValue(undefined)
    attachForReconnect = vi.fn().mockResolvedValue({})
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

const { registerSshPtyProvider } = await import('../ipc/pty')
const { closeSshPtyOutputGeneration } = await import('../ipc/ssh-pty-output-intake-registry')
const { installSshPtySourceAckPublisher } = await import('../ipc/ssh-pty-output-intake-registry')

describe('SshRelaySession data delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
  })
})
