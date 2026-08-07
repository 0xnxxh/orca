/**
 * OOM regression: a daemon owning many terminals retained ~5000 rows per session with no aggregate
 * bound, grew to ~1.9 GB, and was killed under system memory pressure — taking every session it owned
 * with it. TerminalHost must re-split its row budget as the live session count changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalHost } from './terminal-host'
import type { SubprocessHandle } from './session'
import { HeadlessEmulator } from './headless-emulator'
import {
  computeSessionScrollbackRows,
  DAEMON_SCROLLBACK_FULL_ROWS
} from './daemon-scrollback-budget'

function createMockSubprocess(): SubprocessHandle & { _onExitCb: ((code: number) => void) | null } {
  let onExitCb: ((code: number) => void) | null = null
  return {
    pid: 4242,
    getForegroundProcess: vi.fn(() => null),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => {
      setTimeout(() => onExitCb?.(0), 1)
    }),
    forceKill: vi.fn(() => onExitCb?.(137)),
    signal: vi.fn(),
    onData() {},
    onExit(cb) {
      onExitCb = cb
    },
    dispose: vi.fn(),
    get _onExitCb() {
      return onExitCb
    }
  } as SubprocessHandle & { _onExitCb: ((code: number) => void) | null }
}

describe('TerminalHost scrollback budget', () => {
  let host: TerminalHost
  let subprocesses: ReturnType<typeof createMockSubprocess>[]
  let applyRows: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    subprocesses = []
    applyRows = vi.spyOn(HeadlessEmulator.prototype, 'setRetainedScrollbackRows')
    host = new TerminalHost({
      spawnSubprocess: () => {
        const sub = createMockSubprocess()
        subprocesses.push(sub)
        return sub
      }
    })
  })

  afterEach(async () => {
    await host.dispose()
    applyRows.mockRestore()
  })

  async function create(sessionId: string): Promise<void> {
    await host.createOrAttach({
      sessionId,
      cols: 80,
      rows: 24,
      streamClient: { onData: vi.fn(), onExit: vi.fn() }
    })
  }

  function lastAppliedRows(): number {
    const call = applyRows.mock.calls.at(-1)
    return call?.[0] as number
  }

  it('leaves a lightly loaded daemon at full depth', async () => {
    await create('a')
    await create('b')
    expect(lastAppliedRows()).toBe(DAEMON_SCROLLBACK_FULL_ROWS)
  })

  it('applies the budget to every live session, not just the new one', async () => {
    for (let i = 0; i < 4; i++) {
      await create(`session-${i}`)
    }
    // The final create re-applies to all four sessions.
    const lastFour = applyRows.mock.calls.slice(-4)
    expect(lastFour).toHaveLength(4)
    for (const call of lastFour) {
      expect(call[0]).toBe(computeSessionScrollbackRows(4))
    }
  })

  it('reduces per-session depth as the session count grows past the budget', async () => {
    const SESSIONS = 60
    for (let i = 0; i < SESSIONS; i++) {
      await create(`session-${i}`)
    }
    const applied = lastAppliedRows()
    expect(applied).toBe(computeSessionScrollbackRows(SESSIONS))
    expect(applied).toBeLessThan(DAEMON_SCROLLBACK_FULL_ROWS)
  })

  it('restores depth to survivors when sessions exit', async () => {
    const SESSIONS = 60
    for (let i = 0; i < SESSIONS; i++) {
      await create(`session-${i}`)
    }
    const underLoad = lastAppliedRows()

    // Drain back down to a handful of terminals.
    for (let i = 0; i < SESSIONS - 2; i++) {
      subprocesses[i]._onExitCb?.(0)
    }

    expect(host.listSessions()).toHaveLength(2)
    const afterDrain = lastAppliedRows()
    expect(afterDrain).toBeGreaterThan(underLoad)
    expect(afterDrain).toBe(DAEMON_SCROLLBACK_FULL_ROWS)
  })
})
