import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SshRelaySession } from './ssh-relay-session'
import { createMockDeps, mockDeploySuccess } from './ssh-relay-session-test-fixtures'

const { acceptOutputDataMock, acceptOutputExitMock, muxRequestMock } = vi.hoisted(() => ({
  acceptOutputDataMock: vi.fn().mockResolvedValue(undefined),
  acceptOutputExitMock: vi.fn().mockResolvedValue(undefined),
  muxRequestMock: vi.fn()
}))

vi.mock('./ssh-relay-deploy', () => ({ deployAndLaunchRelay: vi.fn() }))
vi.mock('./ssh-pty-consumer-session', () => ({
  openSshPtyConsumerSession: vi.fn(async (_mux, options) => ({
    clientInstanceId: options.clientInstanceId,
    clientGeneration: 1,
    ownerGeneration: 1,
    ownerLease: 'test-owner-lease'
  }))
}))
vi.mock('../ipc/ssh-pty-output-intake-registry', () => ({
  acceptSshPtyOutputData: acceptOutputDataMock,
  acceptSshPtyOutputExit: acceptOutputExitMock,
  allocateSshPtyProviderGeneration: vi.fn(() => 31),
  beginSshPtyOutputGenerationMigration: vi.fn(() => ({
    byPty: new Map(),
    completion: Promise.resolve()
  })),
  closeSshPtyOutputGeneration: vi.fn(),
  getSshPtyAcceptedSourceCheckpoints: vi.fn(() => []),
  applySshPtySourceCancellationProof: vi.fn(() => true),
  applySshPtySourceRecoveryCancellationProof: vi.fn(() => true),
  installSshPtySourceAckPublisher: vi.fn(() => () => {}),
  installSshPtySourceCancellationPublisher: vi.fn(() => () => {})
}))
vi.mock('./ssh-relay-deploy-helpers', () => ({ execCommand: vi.fn().mockResolvedValue('') }))
vi.mock('./ssh-channel-multiplexer', () => ({
  SshChannelMultiplexer: class MockSshChannelMultiplexer {
    notify = vi.fn()
    notifyWithSettlement = vi.fn()
    request = muxRequestMock
    onNotification = vi.fn().mockReturnValue(() => {})
    onNotificationByMethod = vi.fn().mockReturnValue(() => {})
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
  registerSshPtyProvider: vi.fn(),
  unregisterSshPtyProvider: vi.fn(),
  getSshPtyProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
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
  getSshPtyProvider,
  clearProviderPtyState,
  deletePtyOwnership,
  isCurrentPtyExit
} = await import('../ipc/pty')

describe('SSH relay PTY incarnation exits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    muxRequestMock.mockResolvedValue([])
    acceptOutputDataMock.mockResolvedValue(undefined)
    mockDeploySuccess()
    vi.mocked(isCurrentPtyExit).mockReturnValue(true)
  })

  it('drops a stale exit before ownership cleanup and propagates a current incarnation', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow, mockWindow } = createMockDeps()
    const runtime = { onPtyData: vi.fn(), onPtyExit: vi.fn() }
    const session = new SshRelaySession(
      'target-1',
      getMainWindow,
      mockStore,
      mockPortForward,
      runtime as never
    )
    await session.establish(mockConn)
    const provider = vi.mocked(registerSshPtyProvider).mock.calls[0]?.[1] as unknown as {
      onExit: ReturnType<typeof vi.fn>
    }
    const onExit = provider.onExit.mock.calls[0]?.[0] as (payload: {
      id: string
      code: number
      incarnationId: string
      providerGeneration: number
      ptyIncarnation: string
    }) => void
    const acceptExitedPty = vi.fn()
    vi.mocked(getSshPtyProvider).mockReturnValue({
      providerGeneration: 31,
      acceptExitedPty
    } as never)
    vi.mocked(isCurrentPtyExit).mockReturnValueOnce(false)

    onExit({
      id: 'ssh:target-1@@pty-reused',
      code: 0,
      incarnationId: 'old-incarnation',
      providerGeneration: 31,
      ptyIncarnation: 'old-incarnation'
    })

    expect(clearProviderPtyState).not.toHaveBeenCalled()
    expect(deletePtyOwnership).not.toHaveBeenCalled()
    expect(mockStore.markSshRemotePtyLease).not.toHaveBeenCalled()
    expect(acceptOutputExitMock).not.toHaveBeenCalled()
    expect(acceptExitedPty).not.toHaveBeenCalled()
    expect(runtime.onPtyExit).not.toHaveBeenCalled()
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('pty:exit', expect.anything())

    onExit({
      id: 'ssh:target-1@@pty-reused',
      code: 7,
      incarnationId: 'current-incarnation',
      providerGeneration: 31,
      ptyIncarnation: 'current-incarnation'
    })
    await vi.waitFor(() =>
      expect(acceptOutputExitMock).toHaveBeenCalledWith({
        id: 'ssh:target-1@@pty-reused',
        code: 7,
        providerGeneration: 31,
        ptyIncarnation: 'current-incarnation'
      })
    )
    expect(acceptExitedPty).toHaveBeenCalledExactlyOnceWith('ssh:target-1@@pty-reused')
    expect(runtime.onPtyExit).not.toHaveBeenCalled()
  })

  it('promotes liveness only after current output passes intake fencing', async () => {
    const { mockConn, mockStore, mockPortForward, getMainWindow } = createMockDeps()
    const session = new SshRelaySession('target-1', getMainWindow, mockStore, mockPortForward)
    await session.establish(mockConn)
    const provider = vi.mocked(registerSshPtyProvider).mock.calls[0]?.[1] as unknown as {
      onData: ReturnType<typeof vi.fn>
    }
    const onData = provider.onData.mock.calls[0]?.[0] as (payload: {
      id: string
      data: string
      providerGeneration: number
      ptyIncarnation: string
    }) => void
    const acceptLivePty = vi.fn()
    vi.mocked(getSshPtyProvider).mockReturnValue({
      providerGeneration: 31,
      acceptLivePty
    } as never)
    acceptOutputDataMock.mockRejectedValueOnce(new Error('stale incarnation'))

    onData({
      id: 'ssh:target-1@@pty-reused',
      data: 'stale',
      providerGeneration: 31,
      ptyIncarnation: 'old-incarnation'
    })
    await vi.waitFor(() => expect(acceptOutputDataMock).toHaveBeenCalledTimes(1))
    expect(acceptLivePty).not.toHaveBeenCalled()

    onData({
      id: 'ssh:target-1@@pty-reused',
      data: 'current',
      providerGeneration: 31,
      ptyIncarnation: 'current-incarnation'
    })
    await vi.waitFor(() =>
      expect(acceptLivePty).toHaveBeenCalledExactlyOnceWith('ssh:target-1@@pty-reused')
    )
  })
})
