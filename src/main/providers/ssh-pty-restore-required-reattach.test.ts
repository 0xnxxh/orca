import { describe, expect, it, vi } from 'vitest'
import { SSH_PTY_RESTORE_REQUIRED_ERROR, SSH_SESSION_EXPIRED_ERROR } from './ssh-pty-errors'
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
