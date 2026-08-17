import { describe, expect, it, vi } from 'vitest'
import {
  SSH_PTY_LIVENESS_UNVERIFIABLE_ERROR,
  SSH_PTY_RESTORE_REQUIRED_ERROR,
  SSH_SESSION_EXPIRED_ERROR
} from './ssh-pty-errors'
import { MAX_SSH_PTY_EXIT_TOMBSTONES } from './ssh-pty-liveness-state'
import { SshPtyProvider } from './ssh-pty-provider'

// The relay answers `restoreRequired` from its DELIVERY layer only: `requireRestore`
// (src/relay/relay-pty-source-publication.ts) retires the delivery record and never touches the
// managed PTY. Reporting it as expiry orphans a live remote agent and cold-starts a duplicate.

function createMockMux(): {
  request: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  onNotification: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  isDisposed: ReturnType<typeof vi.fn>
} {
  return {
    request: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
    onNotification: vi.fn().mockReturnValue(vi.fn()),
    dispose: vi.fn(),
    isDisposed: vi.fn().mockReturnValue(false)
  }
}

type MockMux = ReturnType<typeof createMockMux>

function notificationHandler(
  mux: MockMux
): (method: string, params: Record<string, unknown>) => void {
  const handler = mux.onNotification.mock.calls[0]?.[0]
  if (typeof handler !== 'function') {
    throw new Error('expected notification handler')
  }
  return handler
}

const restoreRequiredAnswer = {
  incarnationId: 'incarnation-reattached',
  sourceRecovery: { status: 'restoreRequired', reason: 'checkpointUnavailable' }
}

async function spawnError(provider: SshPtyProvider): Promise<string> {
  try {
    await provider.spawn({ cols: 80, rows: 24, sessionId: 'pty-old' })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected spawn to reject')
}

describe('SSH PTY reattach when the relay requires source restoration', () => {
  it('keeps an unprobed PTY unverifiable', async () => {
    const provider = new SshPtyProvider('conn-1', createMockMux() as never)

    expect(provider.hasPty('ssh:conn-1@@pty-unprobed')).toBe(false)
    await expect(provider.probePtyLiveness('ssh:conn-1@@pty-unprobed')).resolves.toBeNull()
  })

  it('reports unverifiable when the initial attach loses contact', async () => {
    const mux = createMockMux()
    mux.request.mockRejectedValueOnce(new Error('Multiplexer disposed'))
    const provider = new SshPtyProvider('conn-1', mux as never)

    const message = await spawnError(provider)

    expect(message).toContain(SSH_PTY_LIVENESS_UNVERIFIABLE_ERROR)
    expect(message).not.toContain(SSH_SESSION_EXPIRED_ERROR)
    expect(provider.hasPty('ssh:conn-1@@pty-old')).toBe(false)
    await expect(provider.probePtyLiveness('ssh:conn-1@@pty-old')).resolves.toBeNull()
    expect(mux.request.mock.calls.filter((call) => call[0] === 'pty.attach')).toHaveLength(1)
  })

  it('keeps a reconnecting PTY unverifiable after an authoritative empty inventory', async () => {
    const id = 'ssh:conn-1@@pty-reconnecting'
    const mux = createMockMux()
    mux.request.mockResolvedValueOnce([])
    const provider = new SshPtyProvider('conn-1', mux as never, undefined, 1, [id])

    await provider.listProcesses()

    expect(provider.hasPty(id)).toBe(false)
    await expect(provider.probePtyLiveness(id)).resolves.toBeNull()
  })

  it('does not classify an exit before the owner validates its incarnation', async () => {
    const id = 'ssh:conn-1@@pty-live'
    const mux = createMockMux()
    const provider = new SshPtyProvider('conn-1', mux as never)
    provider.acceptLivePty(id)

    notificationHandler(mux)('pty.exit', {
      id: 'pty-live',
      code: 0,
      incarnationId: 'stale-incarnation'
    })

    await expect(provider.probePtyLiveness(id)).resolves.toBe(true)
  })

  it('does not revive an exited PTY from unvalidated data or replay', async () => {
    const id = 'ssh:conn-1@@pty-exited'
    const mux = createMockMux()
    const provider = new SshPtyProvider('conn-1', mux as never)
    provider.onData(() => {})
    provider.onReplay(() => {})
    provider.acceptExitedPty(id)

    notificationHandler(mux)('pty.data', { id: 'pty-exited', data: 'stale' })
    notificationHandler(mux)('pty.replay', { id: 'pty-exited', data: 'stale replay' })

    await expect(provider.probePtyLiveness(id)).resolves.toBe(false)
  })

  it('bounds exited PTY evidence and evicts to unverifiable', async () => {
    const provider = new SshPtyProvider('conn-1', createMockMux() as never)
    for (let index = 0; index <= MAX_SSH_PTY_EXIT_TOMBSTONES; index += 1) {
      provider.acceptExitedPty(`pty-${index}`)
    }

    await expect(provider.probePtyLiveness('ssh:conn-1@@pty-0')).resolves.toBeNull()
    await expect(
      provider.probePtyLiveness(`ssh:conn-1@@pty-${MAX_SSH_PTY_EXIT_TOMBSTONES}`)
    ).resolves.toBe(false)
  })

  it('re-attaches over the live PTY instead of reporting exited', async () => {
    const mux = createMockMux()
    // Why: the relay retires the stale delivery record as the restoreRequired response settles,
    // so the immediate re-attach opens a fresh delivery over the same live PTY.
    mux.request
      .mockResolvedValueOnce(restoreRequiredAnswer)
      .mockResolvedValueOnce({ incarnationId: 'incarnation-reattached', replay: 'buffered-output' })
    const provider = new SshPtyProvider('conn-1', mux as never)

    const result = await provider.spawn({ cols: 80, rows: 24, sessionId: 'pty-old' })

    expect(result).toEqual({
      id: 'ssh:conn-1@@pty-old',
      isReattach: true,
      replay: 'buffered-output',
      incarnationId: 'incarnation-reattached'
    })
    expect(mux.request.mock.calls.filter((call) => call[0] === 'pty.attach')).toHaveLength(2)
  })

  it('never reports a delivery failure as session expiry when restoration keeps failing', async () => {
    const mux = createMockMux()
    mux.request.mockResolvedValue(restoreRequiredAnswer)
    const provider = new SshPtyProvider('conn-1', mux as never)

    const message = await spawnError(provider)

    expect(message).not.toContain(SSH_SESSION_EXPIRED_ERROR)
    expect(message).toContain(SSH_PTY_RESTORE_REQUIRED_ERROR)
    expect(provider.hasPty('ssh:conn-1@@pty-old')).toBe(true)
    await expect(provider.probePtyLiveness('ssh:conn-1@@pty-old')).resolves.toBe(true)
  })

  it('reports unverifiable when the fresh delivery attach loses contact', async () => {
    const mux = createMockMux()
    mux.request
      .mockResolvedValueOnce(restoreRequiredAnswer)
      .mockRejectedValueOnce(new Error('Multiplexer disposed'))
    const provider = new SshPtyProvider('conn-1', mux as never)

    const message = await spawnError(provider)

    expect(message).toContain(SSH_PTY_LIVENESS_UNVERIFIABLE_ERROR)
    expect(message).not.toContain(SSH_SESSION_EXPIRED_ERROR)
    expect(provider.hasPty('ssh:conn-1@@pty-old')).toBe(false)
    await expect(provider.probePtyLiveness('ssh:conn-1@@pty-old')).resolves.toBeNull()
    expect(mux.request.mock.calls.filter((call) => call[0] === 'pty.attach')).toHaveLength(2)
  })

  it('reports exited when the fresh delivery attach authoritatively finds no PTY', async () => {
    const mux = createMockMux()
    mux.request
      .mockResolvedValueOnce(restoreRequiredAnswer)
      .mockRejectedValueOnce(new Error('PTY "pty-old" not found'))
    const provider = new SshPtyProvider('conn-1', mux as never)

    const message = await spawnError(provider)

    expect(message).toContain(`${SSH_SESSION_EXPIRED_ERROR}: pty-old`)
    expect(provider.hasPty('ssh:conn-1@@pty-old')).toBe(false)
    await expect(provider.probePtyLiveness('ssh:conn-1@@pty-old')).resolves.toBe(false)
    expect(mux.request.mock.calls.filter((call) => call[0] === 'pty.attach')).toHaveLength(2)
  })

  it('expires the lease when the relay authoritatively reports exited', async () => {
    const mux = createMockMux()
    mux.request.mockRejectedValue(new Error('PTY "pty-old" not found'))
    const provider = new SshPtyProvider('conn-1', mux as never)

    const message = await spawnError(provider)

    expect(message).toContain(`${SSH_SESSION_EXPIRED_ERROR}: pty-old`)
    expect(mux.request.mock.calls.filter((call) => call[0] === 'pty.attach')).toHaveLength(1)
  })
})
