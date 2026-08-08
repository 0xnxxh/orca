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
  allocateSessionScrollbackRows,
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

  async function create(sessionId: string, cols = 80): Promise<void> {
    await host.createOrAttach({
      sessionId,
      cols,
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
      expect(call[0]).toBe(DAEMON_SCROLLBACK_FULL_ROWS)
    }
  })

  it('does not scan every session again when attaching to an existing session', async () => {
    await create('a')
    await create('b')
    applyRows.mockClear()

    await create('a')

    expect(applyRows).not.toHaveBeenCalled()
  })

  it('reduces per-session depth as the session count grows past the budget', async () => {
    const SESSIONS = 60
    for (let i = 0; i < SESSIONS; i++) {
      await create(`session-${i}`)
    }
    const applied = lastAppliedRows()
    expect(applied).toBe(allocateSessionScrollbackRows(Array(SESSIONS).fill(80))[0])
    expect(applied).toBeLessThan(DAEMON_SCROLLBACK_FULL_ROWS)
  })

  it('accounts for each session width without stranding narrow-session capacity', async () => {
    const columns: number[] = []
    for (let i = 0; i < 20; i++) {
      await create(`narrow-${i}`, 40)
      await create(`wide-${i}`, 120)
      columns.push(40, 120)
    }

    expect(applyRows.mock.calls.slice(-40).map((call) => call[0])).toEqual(
      allocateSessionScrollbackRows(columns)
    )
  })

  it('applies each concurrent create before yielding', async () => {
    const pending = Array.from({ length: 30 }, (_, i) => create(`concurrent-${i}`))

    expect(lastAppliedRows()).toBe(allocateSessionScrollbackRows(Array(30).fill(80))[0])
    await Promise.all(pending)
  })

  it('applies a width-aware budget before resizing the emulator', async () => {
    const resizeEmulator = vi.spyOn(HeadlessEmulator.prototype, 'resize')
    try {
      for (let i = 0; i < 25; i++) {
        await create(`session-${i}`)
      }
      expect(lastAppliedRows()).toBe(DAEMON_SCROLLBACK_FULL_ROWS)
      applyRows.mockClear()

      host.resize('session-0', 160, 24)

      expect(applyRows.mock.calls.map((call) => call[0])).toEqual(
        allocateSessionScrollbackRows([160, ...Array(24).fill(80)])
      )
      expect(applyRows.mock.invocationCallOrder.at(-1)).toBeLessThan(
        resizeEmulator.mock.invocationCallOrder[0]
      )

      applyRows.mockClear()
      resizeEmulator.mockClear()
      host.resize('session-0', 80, 24)
      expect(applyRows.mock.calls.map((call) => call[0])).toEqual(Array(25).fill(5000))
      expect(applyRows.mock.invocationCallOrder.at(-1)).toBeLessThan(
        resizeEmulator.mock.invocationCallOrder[0]
      )
    } finally {
      resizeEmulator.mockRestore()
    }
  })

  it('does not scan sessions again for a row-only or rejected resize', async () => {
    await create('a')
    await create('b')
    applyRows.mockClear()

    host.resize('a', 80, 40)
    host.resize('a', Number.NaN, 40)

    expect(applyRows).not.toHaveBeenCalled()
  })

  it('budgets a one-column resize at the headless emulator applied width', async () => {
    for (let i = 0; i < 27; i++) {
      await create(`session-${i}`)
    }
    applyRows.mockClear()

    host.resize('session-0', 1, 24)

    expect(host.getAppliedSize('session-0')?.cols).toBe(2)
    expect(applyRows.mock.calls.map((call) => call[0])).toEqual(
      allocateSessionScrollbackRows([2, ...Array(26).fill(80)])
    )
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

describe('HeadlessEmulator scrollback budget application', () => {
  it('trims immediately without misplacing restored OSC links', () => {
    const emulator = new HeadlessEmulator({ cols: 20, rows: 2, scrollback: 20 })
    try {
      emulator.writeSync(Array.from({ length: 10 }, (_, i) => `L${i}\r\n`).join(''))
      emulator.setRestoredOscLinks([
        { row: 8, startCol: 0, endCol: 2, uri: 'https://retained.invalid' },
        { row: 2, startCol: 0, endCol: 2, uri: 'https://trimmed.invalid' }
      ])

      emulator.setRetainedScrollbackRows(3)

      const snapshot = emulator.getSnapshot()
      expect(snapshot.scrollbackLines).toBe(3)
      expect(snapshot.oscLinks).toEqual([
        { row: 2, startCol: 0, endCol: 2, uri: 'https://retained.invalid' }
      ])
    } finally {
      emulator.dispose()
    }
  })

  it('keeps alternate-buffer restored OSC links fixed while trimming the normal buffer', () => {
    const emulator = new HeadlessEmulator({ cols: 20, rows: 2, scrollback: 20 })
    try {
      emulator.writeSync(Array.from({ length: 10 }, (_, i) => `L${i}\r\n`).join(''))
      emulator.writeSync('\x1b[?1049hALT')
      emulator.setRestoredOscLinks([
        { row: 0, startCol: 0, endCol: 3, uri: 'https://alternate.invalid' }
      ])

      emulator.setRetainedScrollbackRows(3)

      const snapshot = emulator.getSnapshot()
      expect(snapshot.scrollbackLines).toBe(3)
      expect(snapshot.oscLinks).toEqual([
        { row: 0, startCol: 0, endCol: 3, uri: 'https://alternate.invalid' }
      ])
    } finally {
      emulator.dispose()
    }
  })
})
