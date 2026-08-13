import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DaemonPtyAdapter } from './daemon-pty-adapter'
import { DaemonServer } from './daemon-server'
import { getDaemonSocketPath } from './daemon-spawner'
import type { HistoryManager } from './history-manager'
import type { TerminalHistorySessionWriter } from './terminal-history-session-writer'
import type { DaemonFileLog } from './daemon-file-log'
import type { SubprocessHandle } from './session'
import type { PtySpawnResult } from '../providers/types'

const SESSION_A = 'sta-4173-session-a'
const SESSION_B = 'sta-4173-session-b'
const SESSION_B_MARKER = 'SESSION_B_HEALTHY_MARKER'
// Why this short: a healthy local createOrAttach + overlay finishes well under this; a chained hang must lose the race.
const BOUNDED_WAIT_MS = 400

type AdapterCheckpointInternals = {
  runExclusiveCheckpoint: (
    operation: () => Promise<void>,
    options?: { rescheduleDirty?: boolean }
  ) => Promise<void>
  checkpointInFlight: Promise<void> | null
}

function createMockSubprocess(): SubprocessHandle & {
  emitData: (data: string) => void
} {
  let onData: ((data: string) => void) | undefined
  let onExit: ((code: number) => void) | undefined
  return {
    pid: 4242,
    getForegroundProcess: vi.fn(() => null),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => setTimeout(() => onExit?.(0), 1)),
    forceKill: vi.fn(() => onExit?.(137)),
    signal: vi.fn(),
    onData(callback) {
      onData = callback
    },
    onExit(callback) {
      onExit = callback
    },
    dispose: vi.fn(),
    emitData(data) {
      onData?.(data)
    }
  }
}

function sessionWriter(manager: HistoryManager, sessionId: string): TerminalHistorySessionWriter {
  const writer = (
    manager as unknown as { writers: Map<string, TerminalHistorySessionWriter> }
  ).writers.get(sessionId)
  if (!writer) {
    throw new Error(`missing history writer for ${sessionId}`)
  }
  return writer
}

async function raceOutcome(
  promise: Promise<unknown>,
  timeoutMs: number
): Promise<'completed' | 'rejected' | 'timeout'> {
  let finished: 'completed' | 'rejected' | undefined
  const tracked = promise.then(
    () => {
      finished = 'completed'
      return 'completed' as const
    },
    () => {
      finished = 'rejected'
      return 'rejected' as const
    }
  )
  return await Promise.race([
    tracked,
    new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve(finished ?? 'timeout'), timeoutMs)
    })
  ])
}

describe('STA-4173 process-wide checkpoint tail', () => {
  let dir: string
  let historyDir: string
  let server: DaemonServer
  let adapter: DaemonPtyAdapter
  let subprocessBySession: Map<string, ReturnType<typeof createMockSubprocess>>

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sta-4173-checkpoint-tail-'))
    historyDir = join(dir, 'history')
    subprocessBySession = new Map()
    const log: DaemonFileLog = { log: () => {}, close: () => {} }
    server = new DaemonServer({
      socketPath: getDaemonSocketPath(dir),
      tokenPath: join(dir, 'test.token'),
      log,
      spawnSubprocess: (opts) => {
        const subprocess = createMockSubprocess()
        subprocessBySession.set(opts.sessionId, subprocess)
        return subprocess
      }
    })
    await server.start()
    adapter = new DaemonPtyAdapter({
      socketPath: getDaemonSocketPath(dir),
      tokenPath: join(dir, 'test.token'),
      historyPath: historyDir
    })
  })

  afterEach(async () => {
    adapter?.dispose()
    await server?.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })

  async function spawnIndependentSessions(): Promise<{
    manager: HistoryManager
    writerA: TerminalHistorySessionWriter
    writerB: TerminalHistorySessionWriter
    internals: AdapterCheckpointInternals
  }> {
    await adapter.spawn({ cols: 80, rows: 24, sessionId: SESSION_A, cwd: '/tmp' })
    await adapter.spawn({ cols: 80, rows: 24, sessionId: SESSION_B, cwd: '/tmp' })
    subprocessBySession.get(SESSION_B)?.emitData(`${SESSION_B_MARKER}\r\n`)
    const manager = adapter.getHistoryManager()
    if (!manager) {
      throw new Error('expected HistoryManager from historyPath')
    }
    expect(manager.hasWriter(SESSION_A)).toBe(true)
    expect(manager.hasWriter(SESSION_B)).toBe(true)
    return {
      manager,
      writerA: sessionWriter(manager, SESSION_A),
      writerB: sessionWriter(manager, SESSION_B),
      internals: adapter as unknown as AdapterCheckpointInternals
    }
  }

  function stallSessionAWriter(writerA: TerminalHistorySessionWriter): {
    entered: () => boolean
  } {
    let entered = false
    // Intentionally never resolved: one session's history write must hang, not throw.
    const gate = new Promise<void>(() => {})
    vi.spyOn(writerA, 'checkpoint').mockImplementation(async () => {
      entered = true
      await gate
      return { result: 'committed' }
    })
    return { entered: () => entered }
  }

  it('lets a healthy session warm-reattach while another session history write is stalled', async () => {
    const { writerA, writerB } = await spawnIndependentSessions()
    const stall = stallSessionAWriter(writerA)
    const bCheckpoint = vi.spyOn(writerB, 'checkpoint')

    const aOverlay = adapter.getBufferSnapshot(SESSION_A)
    await vi.waitFor(() => {
      expect(stall.entered()).toBe(true)
    })

    const bReattach = adapter.spawn({
      cols: 80,
      rows: 24,
      sessionId: SESSION_B,
      cwd: '/tmp'
    })
    const bOutcome = await raceOutcome(bReattach, BOUNDED_WAIT_MS)
    const aOutcome = await raceOutcome(aOverlay, 20)

    // Why: a throw from A's writer is swallowed by overlayDurableRestoreSnapshot and would
    // unblock B via the catch path — that is not this hang and must not look like a pass.
    expect(stall.entered()).toBe(true)
    expect(aOutcome).toBe('timeout')
    // Desired isolation: B's warm reattach must finish while A is still writing.
    // Today runExclusiveCheckpoint tails onto one adapter-wide promise, so this fails.
    expect(bOutcome).toBe('completed')
    expect(bCheckpoint).toHaveBeenCalled()
    await expect(bReattach).resolves.toMatchObject({
      id: SESSION_B,
      isReattach: true
    } satisfies Partial<PtySpawnResult>)
  })

  it('unblocks the healthy session when the process-wide checkpoint tail is skipped', async () => {
    const { writerA, writerB, internals } = await spawnIndependentSessions()
    const stall = stallSessionAWriter(writerA)
    const bCheckpoint = vi.spyOn(writerB, 'checkpoint')

    const aOverlay = adapter.getBufferSnapshot(SESSION_A)
    await vi.waitFor(() => {
      expect(stall.entered()).toBe(true)
    })

    internals.runExclusiveCheckpoint = async (operation) => {
      await operation()
    }

    const bReattach = adapter.spawn({
      cols: 80,
      rows: 24,
      sessionId: SESSION_B,
      cwd: '/tmp'
    })
    const bOutcome = await raceOutcome(bReattach, BOUNDED_WAIT_MS)
    const aOutcome = await raceOutcome(aOverlay, 20)

    expect(stall.entered()).toBe(true)
    expect(aOutcome).toBe('timeout')
    expect(bOutcome).toBe('completed')
    expect(bCheckpoint).toHaveBeenCalled()
    await expect(bReattach).resolves.toMatchObject({
      id: SESSION_B,
      isReattach: true,
      snapshot: expect.stringContaining(SESSION_B_MARKER)
    })
  })
})
