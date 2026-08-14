import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DaemonPtyAdapter, FinalCheckpointDeadlineError } from './daemon-pty-adapter'
import { DaemonServer } from './daemon-server'
import { getDaemonSocketPath } from './daemon-spawner'
import type { DaemonFileLog } from './daemon-file-log'
import type { HistoryCheckpointResult } from './terminal-history-manager-options'
import type { SubprocessHandle } from './session'
import type { TerminalSnapshot } from './types'

// Why short: the stop deadline is passed in, so this proves the bound without waiting on a real one.
const STOP_DEADLINE_MS = 300
// Why well above the stop deadline: a wedged stop must fail this test, not hang the run.
const STOP_BUDGET_MS = 5_000

function createMockSubprocess(): SubprocessHandle & { emitData: (data: string) => void } {
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

/** Resolves 'timed-out' instead of hanging, so a stranded stop fails the test rather than the run. */
async function withinBudget<T>(work: Promise<T>, budgetMs: number): Promise<T | 'timed-out'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'timed-out'>((resolve) => {
    timer = setTimeout(() => resolve('timed-out'), budgetMs)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

describe('STA-4228 final checkpoint honors the caller stop deadline', () => {
  let dir: string
  let server: DaemonServer
  let adapter: DaemonPtyAdapter
  let subprocesses: ReturnType<typeof createMockSubprocess>[]
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'orca-final-checkpoint-deadline-'))
    subprocesses = []
    const log: DaemonFileLog = { log: () => {}, close: () => {} }
    server = new DaemonServer({
      socketPath: getDaemonSocketPath(dir),
      tokenPath: join(dir, 'test.token'),
      log,
      spawnSubprocess: () => {
        const subprocess = createMockSubprocess()
        subprocesses.push(subprocess)
        return subprocess
      }
    })
    await server.start()
    adapter = new DaemonPtyAdapter({
      socketPath: getDaemonSocketPath(dir),
      tokenPath: join(dir, 'test.token'),
      historyPath: join(dir, 'history')
    })
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    warn?.mockRestore()
    adapter?.dispose()
    await server?.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * Wedges one session's durable write and reports how many times the stall was entered and how
   * many times the underlying write actually completed, so an abandoned wait can be told apart
   * from a dropped checkpoint.
   */
  async function stallCheckpointFor(stalledSessionId: string): Promise<{
    entered: (sessionId?: string) => number
    committed: (sessionId?: string) => number
    release: () => void
  }> {
    const manager = adapter.getHistoryManager()
    expect(manager).not.toBeNull()
    const original = manager!.checkpoint.bind(manager!)
    const entered = new Map<string, number>()
    const committed = new Map<string, number>()
    let release = (): void => {}
    const stalled = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(manager!, 'checkpoint').mockImplementation(
      async (
        sessionId: string,
        snapshot: TerminalSnapshot,
        opts?: { pendingOutputSeq?: number }
      ): Promise<HistoryCheckpointResult> => {
        entered.set(sessionId, (entered.get(sessionId) ?? 0) + 1)
        if (sessionId === stalledSessionId) {
          await stalled
        }
        const result = await original(sessionId, snapshot, opts)
        committed.set(sessionId, (committed.get(sessionId) ?? 0) + 1)
        return result
      }
    )
    return {
      entered: (sessionId = stalledSessionId) => entered.get(sessionId) ?? 0,
      committed: (sessionId = stalledSessionId) => committed.get(sessionId) ?? 0,
      release
    }
  }

  async function spawnWithOutput(sessionId: string, output: string): Promise<string> {
    const { id } = await adapter.spawn({ cols: 80, rows: 24, sessionId, cwd: '/tmp' })
    subprocesses.at(-1)!.emitData(output)
    return id
  }

  it('bounds the wait behind the same-session queue and later commits the final checkpoint', async () => {
    const stalledId = await spawnWithOutput('stalled-stop', 'STALLED_STOP\r\n')
    const stall = await stallCheckpointFor(stalledId)
    const internals = adapter as unknown as {
      checkpointSession(
        sessionId: string,
        opts: { final: boolean; teardown: boolean }
      ): Promise<'done' | 'deferred'>
    }
    const predecessor = internals.checkpointSession(stalledId, {
      final: true,
      teardown: false
    })
    await vi.waitFor(() => expect(stall.entered()).toBe(1))

    const stop = withinBudget(
      adapter
        .shutdown(stalledId, { keepHistory: true, deadlineMs: Date.now() + STOP_DEADLINE_MS })
        .then(() => 'stopped' as const)
        .catch((error: unknown) => error),
      STOP_BUDGET_MS
    )
    const outcome = await stop

    // Before the fix this never settled: the final checkpoint enqueued without a deadline.
    expect(outcome).not.toBe('timed-out')
    expect(outcome).toBeInstanceOf(FinalCheckpointDeadlineError)
    // The stop's final checkpoint is waiting behind the first write and has not run concurrently.
    expect(stall.entered()).toBe(1)
    // The stop must not be silently committed — the PTY stays alive so the caller reports it
    // unstopped rather than recording a sleep whose snapshot never landed.
    expect(subprocesses.at(0)!.kill).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('[history] final checkpoint deadline exceeded:', stalledId)

    // The abandoned checkpoint is never cancelled: releasing it still commits durable history.
    // This is what proves the caller-side bound did not regress STA-4173 losslessness.
    expect(stall.committed()).toBe(0)
    stall.release()
    await predecessor
    await vi.waitFor(() => expect(stall.committed()).toBe(2))
  })

  it('bounds the wait behind the process-wide exclusive tail and later commits', async () => {
    const blockerId = await spawnWithOutput('exclusive-blocker', 'EXCLUSIVE_BLOCKER\r\n')
    const targetId = await spawnWithOutput('exclusive-target', 'EXCLUSIVE_TARGET\r\n')
    const stall = await stallCheckpointFor(blockerId)
    const internals = adapter as unknown as {
      checkpointSession(
        sessionId: string,
        opts: { final: boolean; teardown: boolean }
      ): Promise<'done' | 'deferred'>
      runExclusiveCheckpoint(operation: () => Promise<void>): Promise<void>
    }
    const predecessor = internals.runExclusiveCheckpoint(async () => {
      await internals.checkpointSession(blockerId, { final: true, teardown: false })
    })
    await vi.waitFor(() => expect(stall.entered(blockerId)).toBe(1))

    const outcome = await withinBudget(
      adapter
        .shutdown(targetId, { keepHistory: true, deadlineMs: Date.now() + STOP_DEADLINE_MS })
        .then(() => 'stopped' as const)
        .catch((error: unknown) => error),
      STOP_BUDGET_MS
    )

    expect(outcome).not.toBe('timed-out')
    expect(outcome).toBeInstanceOf(FinalCheckpointDeadlineError)
    expect(stall.entered(targetId)).toBe(0)
    expect(subprocesses.at(1)!.kill).not.toHaveBeenCalled()

    stall.release()
    await predecessor
    await vi.waitFor(() => expect(stall.committed(targetId)).toBe(1))
  })

  it('still stops normally when the final checkpoint beats the deadline', async () => {
    const healthyId = await spawnWithOutput('healthy-stop', 'HEALTHY_STOP\r\n')

    const outcome = await withinBudget(
      adapter
        .shutdown(healthyId, { keepHistory: true, deadlineMs: Date.now() + STOP_BUDGET_MS })
        .then(() => 'stopped' as const)
        .catch((error: unknown) => error),
      STOP_BUDGET_MS
    )

    expect(outcome).toBe('stopped')
    expect(subprocesses.at(0)!.kill).toHaveBeenCalled()
  })

  it('waits without a bound when the caller supplies no deadline', async () => {
    const stalledId = await spawnWithOutput('unbounded-stop', 'UNBOUNDED_STOP\r\n')
    const stall = await stallCheckpointFor(stalledId)

    const stop = adapter
      .shutdown(stalledId, { keepHistory: true })
      .then(() => 'stopped' as const)
      .catch((error: unknown) => error)
    void stop.catch(() => {})
    await vi.waitFor(() => expect(stall.entered()).toBe(1))

    // A deadline-free caller keeps the pre-existing lossless contract: it waits for the write.
    expect(await withinBudget(stop, STOP_DEADLINE_MS)).toBe('timed-out')
    stall.release()
    expect(await withinBudget(stop, STOP_BUDGET_MS)).toBe('stopped')
    expect(stall.committed()).toBe(1)
  })
})
