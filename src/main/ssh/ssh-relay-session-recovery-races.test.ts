import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SshRelaySession } from './ssh-relay-session'
import { createMockDeps, mockDeploySuccess } from './ssh-relay-session-test-fixtures'

const {
  acceptOutputDataMock,
  muxRequestMock,
  onNotificationByMethodMock,
  openConsumerSessionMock,
  muxDisposeMock,
  attachForReconnectMock,
  ptyDataHandlerRef
} = vi.hoisted(() => ({
  acceptOutputDataMock: vi.fn().mockResolvedValue(undefined),
  muxRequestMock: vi.fn(),
  onNotificationByMethodMock: vi.fn(),
  openConsumerSessionMock: vi.fn(),
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
    notifyWithSettlement = vi.fn()
    request = muxRequestMock
    onNotification = vi.fn().mockReturnValue(() => {})
    onNotificationByMethod = onNotificationByMethodMock.mockImplementation(() => () => {})
    onRequest = vi.fn().mockReturnValue(() => {})
    onDispose = vi.fn().mockReturnValue(() => {})
    dispose = muxDisposeMock
    isDisposed = vi.fn().mockReturnValue(false)
  }
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
    attachForReconnect = attachForReconnectMock
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

const {
  clearProviderPtyState,
  clearPtyOwnershipForConnection,
  deletePtyOwnership,
  getSshPtyProvider,
  getPtyIdsForConnection,
  registerSshPtyProvider,
  setPtyOwnership
} = await import('../ipc/pty')
const { closeSshPtyOutputGeneration, getSshPtyAcceptedSourceCheckpoints } =
  await import('../ipc/ssh-pty-output-intake-registry')

describe('SshRelaySession recovery race fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ptyDataHandlerRef.current = undefined
    attachForReconnectMock.mockResolvedValue({})
    vi.mocked(getPtyIdsForConnection).mockReturnValue([])
    vi.mocked(getSshPtyAcceptedSourceCheckpoints).mockReturnValue([])
    muxRequestMock.mockResolvedValue([])
    mockDeploySuccess()
  })

  function emitSourceFrame(args: {
    targetId: string
    token: string
    clientGeneration: number
    ownerGeneration: number
    sourceStartSu: number
    sourceEndSu: number
  }): void {
    ptyDataHandlerRef.current?.({
      id: `ssh:${args.targetId}@@pty-1`,
      data: 'late',
      providerGeneration: 23,
      ptyIncarnation: 'incarnation-1',
      sequenceChars: args.sourceEndSu - args.sourceStartSu,
      source: {
        relayPtyId: 'pty-1',
        spanId: `${args.token}:${args.sourceStartSu}:${args.sourceEndSu}`,
        clientGeneration: args.clientGeneration,
        ownerGeneration: args.ownerGeneration,
        deliveryToken: args.token,
        sourceStartSu: args.sourceStartSu,
        sourceEndSu: args.sourceEndSu
      }
    })
  }

  async function prepareRecovery(targetId: string): Promise<{
    session: SshRelaySession
    deps: ReturnType<typeof createMockDeps>
  }> {
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
        id: `ssh:${targetId}@@pty-1`,
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
      targetId,
      deps.getMainWindow,
      deps.mockStore,
      deps.mockPortForward,
      undefined,
      undefined,
      () => true
    )
    await session.establish(deps.mockConn)
    vi.mocked(getPtyIdsForConnection).mockReturnValue([`ssh:${targetId}@@pty-1`])
    vi.mocked(getSshPtyProvider).mockImplementation(
      () => vi.mocked(registerSshPtyProvider).mock.calls.at(-1)?.[1]
    )
    return { session, deps }
  }

  it('retains the empty recovery end as the first post-activation source anchor', async () => {
    const targetId = 'empty-recovery-gap'
    const { session, deps } = await prepareRecovery(targetId)
    attachForReconnectMock.mockImplementation(async () => {
      queueMicrotask(() => {
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
          recoveryEndSu: 4
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
          recoveryEndSu: 4
        }
      }
    })
    await session.reconnect(deps.mockConn)
    const closeCount = vi.mocked(closeSshPtyOutputGeneration).mock.calls.length

    emitSourceFrame({
      targetId,
      token: 'new-token',
      clientGeneration: 2,
      ownerGeneration: 2,
      sourceStartSu: 5,
      sourceEndSu: 8
    })

    expect(acceptOutputDataMock).not.toHaveBeenCalled()
    expect(closeSshPtyOutputGeneration).toHaveBeenCalledTimes(closeCount + 1)
    expect(closeSshPtyOutputGeneration).toHaveBeenLastCalledWith(
      23,
      'ssh_source_frame_stale_or_non_contiguous'
    )
  })

  it('drops late frames from a token after its cancellation proof is validated', async () => {
    const targetId = 'late-after-cancel'
    muxRequestMock.mockImplementation(async (method) =>
      method === 'pty.cancelDelivery' ? { canceled: true, sentEndSu: 8, creditedEndSu: 4 } : []
    )
    const { session, deps } = await prepareRecovery(targetId)
    attachForReconnectMock.mockImplementation(async () => {
      queueMicrotask(() => {
        emitSourceFrame({
          targetId,
          token: 'new-token',
          clientGeneration: 2,
          ownerGeneration: 2,
          sourceStartSu: 5,
          sourceEndSu: 8
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
    await session.reconnect(deps.mockConn)
    const closeCount = vi.mocked(closeSshPtyOutputGeneration).mock.calls.length

    emitSourceFrame({
      targetId,
      token: 'new-token',
      clientGeneration: 2,
      ownerGeneration: 2,
      sourceStartSu: 8,
      sourceEndSu: 12
    })

    expect(acceptOutputDataMock).not.toHaveBeenCalled()
    expect(closeSshPtyOutputGeneration).toHaveBeenCalledTimes(closeCount)
    expect(deps.mockStore.markSshRemotePtyLease).toHaveBeenCalledWith(targetId, 'pty-1', 'detached')
    expect(clearProviderPtyState).not.toHaveBeenCalled()
    expect(clearPtyOwnershipForConnection).not.toHaveBeenCalled()
    expect(deletePtyOwnership).not.toHaveBeenCalled()
    expect(deps.mockWindow.webContents.send).not.toHaveBeenCalledWith('pty:exit', expect.anything())
    expect(muxDisposeMock).not.toHaveBeenCalledWith('shutdown')
  })

  it('keeps a stale overlapping recovery from canceling or mutating its replacement', async () => {
    const targetId = 'overlapping-recovery'
    const { session, deps } = await prepareRecovery(targetId)
    const staleLease = { commit: vi.fn(), rollback: vi.fn() }
    const replacementLease = { commit: vi.fn(), rollback: vi.fn() }
    attachForReconnectMock.mockImplementation(async () => {
      const ownerGeneration = openConsumerSessionMock.mock.calls.length
      if (ownerGeneration === 3) {
        queueMicrotask(() => {
          const complete = onNotificationByMethodMock.mock.calls.findLast(
            ([method]) => method === 'pty.recoveryComplete'
          )?.[1] as ((params: Record<string, unknown>) => void) | undefined
          complete?.({
            id: 'pty-1',
            clientGeneration: 3,
            ownerGeneration: 3,
            ptyIncarnation: 'incarnation-1',
            deliveryToken: 'replacement-token',
            checkpointSourceEndSu: 4,
            recoveryEndSu: 4
          })
        })
      }
      return {
        incarnationId: 'incarnation-1',
        sourceRecovery: {
          status: 'pending',
          clientGeneration: ownerGeneration,
          ownerGeneration,
          ptyIncarnation: 'incarnation-1',
          deliveryToken: ownerGeneration === 2 ? 'stale-token' : 'replacement-token',
          checkpointSourceEndSu: 4,
          recoveryEndSu: 4
        },
        sourceActivationLease: ownerGeneration === 2 ? staleLease : replacementLease
      }
    })

    const staleReconnect = session.reconnect(deps.mockConn)
    await vi.waitFor(() => expect(attachForReconnectMock).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    const replacementReconnect = session.reconnect(deps.mockConn)
    await Promise.all([staleReconnect, replacementReconnect])

    const recoveryRequests = attachForReconnectMock.mock.calls.map((call) => call[2])
    expect(recoveryRequests).toHaveLength(2)
    expect(recoveryRequests[1]).toMatchObject({
      status: 'checkpoint',
      deliveryToken: 'old-token',
      acceptedSourceEndSu: 4
    })
    expect(muxRequestMock.mock.calls.filter(([method]) => method === 'pty.cancelDelivery')).toEqual(
      []
    )
    expect(deps.mockStore.markSshRemotePtyLease).toHaveBeenCalledTimes(1)
    expect(deps.mockStore.markSshRemotePtyLease).toHaveBeenCalledWith(targetId, 'pty-1', 'attached')
    expect(setPtyOwnership).toHaveBeenCalledTimes(1)
    expect(staleLease.rollback).toHaveBeenCalledOnce()
    expect(staleLease.commit).not.toHaveBeenCalled()
    expect(replacementLease.commit).toHaveBeenCalledOnce()
    expect(replacementLease.rollback).not.toHaveBeenCalled()
    expect(clearProviderPtyState).not.toHaveBeenCalled()
    expect(clearPtyOwnershipForConnection).not.toHaveBeenCalled()
    expect(deletePtyOwnership).not.toHaveBeenCalled()
    expect(deps.mockWindow.webContents.send).not.toHaveBeenCalledWith('pty:exit', expect.anything())
    expect(muxDisposeMock).not.toHaveBeenCalledWith('shutdown')
    expect(session.getState()).toBe('ready')
  })
})
