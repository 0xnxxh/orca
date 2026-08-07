/**
 * Stranded-daemon regression: Windows has no endpoint-ownership retirement, so a superseded daemon
 * lingers for the machine's uptime — five accumulated on one host, the oldest 12 days old. A legacy
 * daemon that owns nothing must retire; one that still owns sessions, or cannot be inventoried, must not.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DaemonPtyAdapter } from './daemon-pty-adapter'
import { DaemonServer } from './daemon-server'
import { getDaemonSocketPath } from './daemon-spawner'
import type { SubprocessHandle } from './session'

function fixtureSubprocess(): SubprocessHandle {
  let onExitCb: ((code: number) => void) | null = null
  return {
    pid: 1234,
    getForegroundProcess: () => null,
    write: () => {},
    resize: () => {},
    kill: () => {
      setTimeout(() => onExitCb?.(0), 1)
    },
    forceKill: () => onExitCb?.(137),
    signal: () => {},
    onData: () => {},
    onExit: (cb) => {
      onExitCb = cb
    },
    dispose: () => {}
  } as SubprocessHandle
}

describe('legacy daemon retirement', () => {
  let dir: string
  let socketPath: string
  let tokenPath: string
  let server: DaemonServer | null
  let adapter: DaemonPtyAdapter | null
  let owner: DaemonPtyAdapter | null

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'legacy-daemon-retirement-'))
    socketPath = getDaemonSocketPath(dir)
    tokenPath = join(dir, 'daemon.token')
    server = null
    adapter = null
    owner = null
  })

  afterEach(async () => {
    await adapter?.disconnectOnly().catch(() => {})
    await owner?.disconnectOnly().catch(() => {})
    await server?.shutdown().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  })

  async function startServer(): Promise<DaemonServer> {
    const started = new DaemonServer({
      socketPath,
      tokenPath,
      spawnSubprocess: () => fixtureSubprocess()
    })
    await started.start()
    server = started
    return started
  }

  function createAdapter(): DaemonPtyAdapter {
    adapter = new DaemonPtyAdapter({
      socketPath,
      tokenPath,
      profileScope: dir,
      historyPath: join(dir, 'history')
    })
    return adapter
  }

  it('retires a daemon that owns no sessions', async () => {
    await startServer()
    const retired = await createAdapter().retireIfEmpty()
    expect(retired).toBe(true)
  })

  it('preserves a daemon that still owns a live session', async () => {
    await startServer()
    owner = new DaemonPtyAdapter({
      socketPath,
      tokenPath,
      profileScope: dir,
      historyPath: join(dir, 'history')
    })
    await owner.spawn({ sessionId: 'still-owned', cols: 80, rows: 24 })

    const retired = await createAdapter().retireIfEmpty()

    expect(retired).toBe(false)
    // The session the stranded daemon still owns is untouched.
    expect(await owner.listSessions()).toHaveLength(1)
  })

  it('fails closed when the daemon cannot be reached at all', async () => {
    // No server listening: the inventory is unverifiable, so the daemon must be preserved and routed.
    const retired = await createAdapter().retireIfEmpty()
    expect(retired).toBe(false)
  })

  it('fails closed rather than hanging on a wedged daemon that never answers hello', async () => {
    // A stale daemon can accept the socket and never reply. Without a budget this would block the
    // startup path on the client's 30s request timeout — on the machine least able to afford it.
    writeFileSync(tokenPath, 'wedged-token', { mode: 0o600 })
    const accepted: Socket[] = []
    const wedged = createServer((socket) => {
      // Accept and go silent.
      accepted.push(socket)
    })
    await new Promise<void>((resolve) => wedged.listen(socketPath, resolve))
    try {
      const startedAt = Date.now()

      const retired = await createAdapter().retireIfEmpty(200)

      expect(retired).toBe(false)
      expect(Date.now() - startedAt).toBeLessThan(5_000)
    } finally {
      // close() alone waits on live connections, and the adapter's sockets are still open.
      for (const socket of accepted) {
        socket.destroy()
      }
      await new Promise<void>((resolve) => wedged.close(() => resolve()))
    }
  })
})
