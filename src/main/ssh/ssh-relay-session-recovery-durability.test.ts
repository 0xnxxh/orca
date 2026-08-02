import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SshRelaySession } from './ssh-relay-session'
import { createMockDeps } from './ssh-relay-session-test-fixtures'

const { muxRequestMock, openConsumerSessionMock } = vi.hoisted(() => ({
  muxRequestMock: vi.fn(),
  openConsumerSessionMock: vi.fn()
}))

vi.mock('./ssh-relay-deploy', () => ({ deployAndLaunchRelay: vi.fn() }))
vi.mock('./ssh-pty-consumer-session', () => ({
  openSshPtyConsumerSession: openConsumerSessionMock
}))
vi.mock('../ipc/ssh-pty-output-intake-registry', () => ({
  acceptSshPtyOutputData: vi.fn().mockResolvedValue(undefined),
  acceptSshPtyOutputExit: vi.fn().mockResolvedValue(undefined),
  allocateSshPtyProviderGeneration: vi.fn(() => 23),
  beginSshPtyOutputGenerationMigration: vi.fn(() => ({
    byPty: new Map(),
    completion: Promise.resolve()
  })),
  closeSshPtyOutputGeneration: vi.fn(),
  getSshPtyAcceptedSourceCheckpoints: vi.fn(() => []),
  installSshPtySourceAckPublisher: vi.fn(() => () => {}),
  installSshPtySourceCancellationPublisher: vi.fn(() => () => {}),
  applySshPtySourceCancellationProof: vi.fn(),
  applySshPtySourceRecoveryCancellationProof: vi.fn()
}))

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
  isSshPtyNotFoundError: vi.fn().mockReturnValue(false),
  isSshPtyIdentityMismatchError: vi.fn().mockReturnValue(false),
  SshPtyProvider: class MockSshPtyProvider {
    onData = vi.fn().mockReturnValue(() => {})
    onReplay = vi.fn().mockReturnValue(() => {})
    onExit = vi.fn().mockReturnValue(() => {})
    attach = vi.fn().mockResolvedValue(undefined)
    attachForReconnect = vi.fn().mockResolvedValue({})
    setPtyDeliveryPauseAdapter = vi.fn()
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

const { deployAndLaunchRelay } = await import('./ssh-relay-deploy')

describe('SshRelaySession consumer recovery durability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    muxRequestMock.mockResolvedValue([])
    openConsumerSessionMock.mockImplementation(async (_mux, options) => ({
      mode: 'negotiated',
      clientInstanceId: options.clientInstanceId,
      clientGeneration: 1,
      ownerGeneration: 1,
      ownerLease: 'test-owner-lease'
    }))
    vi.mocked(deployAndLaunchRelay).mockResolvedValue({
      transport: { write: vi.fn(), onData: vi.fn(), onClose: vi.fn() },
      platform: 'linux-x64',
      serverBuildId: 'test-relay-build'
    })
  })

  it('holds establish open until the consumer recovery write is durable', async () => {
    const deps = createMockDeps()
    let settleWrite!: () => void
    let signalWriteStarted!: () => void
    const writeStarted = new Promise<void>((resolve) => {
      signalWriteStarted = resolve
    })
    vi.mocked(deps.mockStore.upsertSshPtyConsumerRecovery).mockImplementation(() => {
      signalWriteStarted()
      return new Promise<void>((resolve) => {
        settleWrite = resolve
      })
    })

    const session = new SshRelaySession(
      'durability-barrier-target',
      deps.getMainWindow,
      deps.mockStore,
      deps.mockPortForward
    )
    let established = false
    const establishing = session.establish(deps.mockConn).then(() => {
      established = true
    })

    await writeStarted
    // Why a macrotask, not a microtask count: establish() has several awaits after the write starts,
    // so only yielding past the whole microtask queue proves the write is the thing blocking it.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(established).toBe(false)

    settleWrite()
    await establishing
    expect(established).toBe(true)
    session.dispose()
  })
})
