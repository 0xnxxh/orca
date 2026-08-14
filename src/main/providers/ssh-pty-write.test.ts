import { describe, expect, it, vi } from 'vitest'
import { SshPtyProvider } from './ssh-pty-provider'
import { SSH_PTY_WRITE_SETTLEMENT_TIMEOUT_MS } from './ssh-pty-write'

describe('SSH PTY writes', () => {
  it('rejects writes synchronously after the transport is disposed', () => {
    const mux = {
      isDisposed: vi.fn().mockReturnValue(true),
      notify: vi.fn(),
      onNotification: vi.fn()
    }
    const provider = new SshPtyProvider('conn-1', mux as never)

    expect(provider.write('ssh:conn-1@@pty-1', 'pointer')).toBe(false)
    expect(mux.notify).not.toHaveBeenCalled()
  })

  it('reports a failed transport settlement instead of enqueue acceptance', async () => {
    let settle: ((result: { ok: true } | { ok: false; error: Error }) => void) | undefined
    const mux = {
      isDisposed: vi.fn().mockReturnValue(false),
      notify: vi.fn(),
      notifyWithSettlement: vi.fn((_method, _params, onSettled) => {
        settle = onSettled
      }),
      onNotification: vi.fn()
    }
    const provider = new SshPtyProvider('conn-1', mux as never)

    const pending = provider.writeWithSettlement('ssh:conn-1@@pty-1', 'pointer')
    expect(mux.notifyWithSettlement).toHaveBeenCalledWith(
      'pty.data',
      { id: 'pty-1', data: 'pointer' },
      expect.any(Function)
    )
    settle?.({ ok: false, error: new Error('transport rejected write') })

    await expect(pending).resolves.toBe(false)
  })

  it('disconnects a transport whose write settlement never arrives', async () => {
    vi.useFakeTimers()
    const mux = {
      isDisposed: vi.fn().mockReturnValue(false),
      notify: vi.fn(),
      notifyWithSettlement: vi.fn(),
      onNotification: vi.fn(),
      dispose: vi.fn()
    }
    const provider = new SshPtyProvider('conn-1', mux as never)
    const pending = provider.writeWithSettlement('ssh:conn-1@@pty-1', 'pointer')

    await vi.advanceTimersByTimeAsync(SSH_PTY_WRITE_SETTLEMENT_TIMEOUT_MS - 1)
    expect(mux.dispose).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    await expect(pending).resolves.toBe(false)
    expect(mux.dispose).toHaveBeenCalledWith('connection_lost')
    vi.useRealTimers()
  })

  it('accepts a healthy settlement after the mux health window', async () => {
    vi.useFakeTimers()
    let settle: ((result: { ok: true }) => void) | undefined
    const mux = {
      isDisposed: vi.fn().mockReturnValue(false),
      notify: vi.fn(),
      notifyWithSettlement: vi.fn(
        (_method: string, _params: unknown, callback: (result: { ok: true }) => void) => {
          settle = callback
        }
      ),
      onNotification: vi.fn(),
      dispose: vi.fn()
    }
    const provider = new SshPtyProvider('conn-1', mux as never)
    const pending = provider.writeWithSettlement('ssh:conn-1@@pty-1', 'pointer')

    await vi.advanceTimersByTimeAsync(SSH_PTY_WRITE_SETTLEMENT_TIMEOUT_MS - 1)
    settle?.({ ok: true })

    await expect(pending).resolves.toBe(true)
    expect(mux.dispose).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
