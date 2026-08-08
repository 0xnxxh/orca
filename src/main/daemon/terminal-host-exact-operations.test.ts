import { describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle } from './session'
import { TerminalHost } from './terminal-host'

describe('TerminalHost exact PTY operations', () => {
  it('admits only the live physical incarnation', async () => {
    let onExit: ((code: number) => void) | undefined
    const subprocess: SubprocessHandle = {
      pid: 99999,
      getForegroundProcess: () => null,
      write: vi.fn(),
      resize: vi.fn(),
      clear: vi.fn(),
      kill: vi.fn(() => onExit?.(0)),
      forceKill: vi.fn(() => onExit?.(137)),
      signal: vi.fn(),
      onData: vi.fn(),
      onExit: (callback) => {
        onExit = callback
      },
      dispose: vi.fn()
    }
    const host = new TerminalHost({ spawnSubprocess: () => subprocess })

    try {
      const result = await host.createOrAttach({
        sessionId: 'session-1',
        cols: 80,
        rows: 24,
        streamClient: { onData: vi.fn(), onExit: vi.fn() }
      })

      expect(host.writeExact('session-1', 'stale-incarnation', 'stale')).toBe(false)
      expect(host.resizeExact('session-1', 'stale-incarnation', 120, 40)).toBe(false)
      await expect(host.killExact('session-1', 'stale-incarnation')).resolves.toBe(false)
      expect(host.signalExact('session-1', 'stale-incarnation', 'SIGTERM')).toBe(false)
      expect(host.clearScrollbackExact('session-1', 'stale-incarnation')).toBe(false)
      expect(host.writeExact('session-1', result.incarnationId, 'current')).toBe(true)
      expect(host.resizeExact('session-1', result.incarnationId, 120, 40)).toBe(true)
      expect(host.signalExact('session-1', result.incarnationId, 'SIGTERM')).toBe(true)
      expect(host.clearScrollbackExact('session-1', result.incarnationId)).toBe(true)
      expect(subprocess.write).toHaveBeenCalledWith('current')
      expect(subprocess.resize).toHaveBeenCalledWith(120, 40)
      expect(subprocess.signal).toHaveBeenCalledWith('SIGTERM')
      expect(subprocess.clear).toHaveBeenCalledOnce()
      await expect(host.killExact('session-1', result.incarnationId)).resolves.toBe(true)
      expect(subprocess.kill).toHaveBeenCalledOnce()
    } finally {
      await host.dispose()
    }
  })
})
