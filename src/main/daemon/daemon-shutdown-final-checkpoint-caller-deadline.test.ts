import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DaemonPtyAdapter } from './daemon-pty-adapter'
import { DaemonServer } from './daemon-server'
import { getDaemonSocketPath } from './daemon-spawner'
import type { DaemonFileLog } from './daemon-file-log'
import { HistoryReader } from './history-reader'
import type { HistoryCheckpointResult } from './terminal-history-manager-options'
import type { SubprocessHandle } from './session'
import type { TerminalSnapshot } from './types'

// Worktree sleep threads an absolute deadline into stopAndWait; this stands in for it.
const CALLER_DEADLINE_MS = 300
// Why well above the deadline it proves: a stop that only settles because the whole suite is slow
// would prove nothing, and a stop that never settles must fail this test rather than hang the run.
const STOP_BUDGET_MS = 8_000

function createMockSubprocess(): SubprocessHandle & { emitData: (data: string) => void } {
  let onData: ((data: string) => void) | undefined
  let onExit: ((code: number) => void) | undefined
  return {
    pid: 4243,
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
  const budget = new Promise<'timed-out'>((resolve) => {
    timer = setTimeout(() => resolve('timed-out'), budgetMs)
  })
  try {
    return await Promise.race([work, budget])
  } finally {
    clearTimeout(timer)
  }
}

/** Settles to a tag either way, so a rejecting stop still counts as "the caller stopped waiting". */
function settlementOf(work: Promise<unknown>): Promise<'settled'> {
  return work.then(
    () => 'settled' as const,
    () => 'settled' as const
  )
}

describe('STA-4228 keep-history stop bounds only the caller wait on the final checkpoint', () => {
  let dir: string
  let server: DaemonServer
  let adapter: DaemonPtyAdapter
  let subprocesses: ReturnType<typeof createMockSubprocess>[]

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
  })

  afterEach(async () => {
    adapter?.dispose()
    await server?.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * Wedges one session's checkpoint at the history-write layer and reports how many times that
   * stall was actually entered, so a swallowed TypeError cannot masquerade as a stall.
   */
  function stallCheckpointFor(stalledSessionId: string): {
    entered: () => number
    release: () => void
  } {
    const manager = adapter.getHistoryManager()
    expect(manager).not.toBeNull()
    const original = manager!.checkpoint.bind(manager!)
    let entered = 0
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
        if (sessionId !== stalledSessionId) {
          return await original(sessionId, snapshot, opts)
        }
        entered += 1
        await stalled
        return await original(sessionId, snapshot, opts)
      }
    )
    return { entered: () => entered, release }
  }

  async function spawnWithOutput(sessionId: string, output: string): Promise<string> {
    const { id } = await adapter.spawn({ cols: 80, rows: 24, sessionId, cwd: '/tmp' })
    subprocesses.at(-1)!.emitData(output)
    return id
  }

  function stopKeepingHistory(id: string): Promise<void> {
    return adapter.shutdown(id, {
      immediate: true,
      keepHistory: true,
      deadlineMs: Date.now() + CALLER_DEADLINE_MS
    })
  }

  async function onDisk(sessionId: string): Promise<string> {
    const restore = await new HistoryReader(join(dir, 'history')).detectColdRestore(sessionId, {
      ignoreCleanEnd: true
    })
    return `${restore?.scrollbackAnsi ?? ''}${restore?.snapshotAnsi ?? ''}`
  }

  it('lets a later keep-history stop settle while an earlier final checkpoint is wedged', async () => {
    const wedgedId = await spawnWithOutput('wedged-session', 'WEDGED_OUTPUT\r\n')
    const laterId = await spawnWithOutput('later-session', 'LATER_OUTPUT\r\n')
    const stall = stallCheckpointFor(wedgedId)

    const wedgedStop = settlementOf(stopKeepingHistory(wedgedId))
    await vi.waitFor(() => expect(stall.entered()).toBeGreaterThan(0))

    expect(await withinBudget(wedgedStop, STOP_BUDGET_MS)).toBe('settled')
    // Why issued only now: this is the sleep-stranding case — a stop that starts while the wedged
    // checkpoint still owns the exclusive tail, which before this fix waited on it forever.
    expect(await withinBudget(settlementOf(stopKeepingHistory(laterId)), STOP_BUDGET_MS)).toBe(
      'settled'
    )
    // The wedge must still be parked, or neither stop proved anything.
    expect(stall.entered()).toBe(1)
    stall.release()
  }, 30_000)

  it('leaves the unverified pty alive instead of falling through to the kill', async () => {
    const wedgedId = await spawnWithOutput('alive-session', 'ALIVE_OUTPUT\r\n')
    const stall = stallCheckpointFor(wedgedId)

    const wedgedStop = settlementOf(stopKeepingHistory(wedgedId))
    await vi.waitFor(() => expect(stall.entered()).toBeGreaterThan(0))
    expect(await withinBudget(wedgedStop, STOP_BUDGET_MS)).toBe('settled')

    // Why liveness and not just bookkeeping: the whole point is that an unproven snapshot must not
    // authorize the kill, so the daemon must still answer for this session.
    expect(await adapter.probePtyLiveness(wedgedId)).toBe(true)
    expect(adapter.hasPty(wedgedId)).toBe(true)
    stall.release()
  }, 30_000)

  it('still commits every abandoned final checkpoint once the wedged history write completes', async () => {
    const wedgedId = await spawnWithOutput('committing-session', 'COMMITTING_OUTPUT\r\n')
    const laterId = await spawnWithOutput('queued-session', 'QUEUED_OUTPUT\r\n')
    const stall = stallCheckpointFor(wedgedId)

    const wedgedStop = settlementOf(stopKeepingHistory(wedgedId))
    await vi.waitFor(() => expect(stall.entered()).toBeGreaterThan(0))
    expect(await withinBudget(wedgedStop, STOP_BUDGET_MS)).toBe('settled')
    expect(await withinBudget(settlementOf(stopKeepingHistory(laterId)), STOP_BUDGET_MS)).toBe(
      'settled'
    )
    expect(stall.entered()).toBe(1)

    stall.release()
    // Why this is the whole point of bounding the wait and not the work: both callers walked away,
    // and both durable writes still land on disk — the abandoned one and the one queued behind it.
    await vi.waitFor(async () => {
      expect(await onDisk(wedgedId)).toContain('COMMITTING_OUTPUT')
      expect(await onDisk(laterId)).toContain('QUEUED_OUTPUT')
    })
  }, 30_000)
})
