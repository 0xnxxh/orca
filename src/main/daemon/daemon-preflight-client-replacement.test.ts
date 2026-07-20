import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { DaemonClient } from './client'
import { DaemonServer } from './daemon-server'
import type { SubprocessHandle } from './session'

type DaemonServerPrivate = {
  pendingPtySpawnPreparations: Map<string, Set<unknown>>
}

function createMockSubprocess(): SubprocessHandle {
  return {
    pid: 55555,
    getForegroundProcess: vi.fn(() => null),
    confirmForegroundProcess: vi.fn(async () => null),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    forceKill: vi.fn(),
    signal: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    dispose: vi.fn()
  }
}

describe('daemon preflight client replacement', () => {
  let dir: string
  let server: DaemonServer

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'daemon-preflight-replacement-'))
  })

  afterEach(async () => {
    await server?.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })

  it('cancels preparation when a reconnect replaces the owning control socket', async () => {
    let finishPreparation!: () => void
    const preparation = new Promise<void>((resolve) => {
      finishPreparation = resolve
    })
    const preparePtySpawn = vi.fn(() => preparation)
    const spawnSubprocess = vi.fn(() => createMockSubprocess())
    const socketPath = join(dir, 'daemon.sock')
    const tokenPath = join(dir, 'daemon.token')
    server = new DaemonServer({ socketPath, tokenPath, preparePtySpawn, spawnSubprocess })
    await server.start()

    const original = new DaemonClient({ socketPath, tokenPath })
    const replacement = new DaemonClient({ socketPath, tokenPath })
    ;(original as unknown as { clientId: string }).clientId = 'reused-client-id'
    ;(replacement as unknown as { clientId: string }).clientId = 'reused-client-id'
    await original.ensureConnected()
    original
      .request('createOrAttach', {
        sessionId: 'replacement-pending',
        cols: 80,
        rows: 24
      })
      .catch(() => {
        /* replacement disconnects the original request */
      })
    await vi.waitFor(() => expect(preparePtySpawn).toHaveBeenCalledOnce())

    await replacement.ensureConnected()
    finishPreparation()
    await vi.waitFor(() =>
      expect((server as unknown as DaemonServerPrivate).pendingPtySpawnPreparations.size).toBe(0)
    )
    expect(spawnSubprocess).not.toHaveBeenCalled()

    replacement.disconnect()
    original.disconnect()
  })
})
