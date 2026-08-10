/**
 * OOM regression: a daemon owning 100+ terminals retained ~5000 rows per session with no bound, grew
 * to ~1.9 GB, and was killed under system memory pressure — losing every session it owned. Retention
 * bounds that by trimming only PARKED sessions past an LRU cap. A terminal the user is viewing, or
 * viewed recently, must never lose reachable scrollback depth.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalHost } from './terminal-host'
import type { SubprocessHandle } from './session'
import { HeadlessEmulator } from './headless-emulator'
import {
  DAEMON_PARKED_FULL_DEPTH_CAP,
  DAEMON_SCROLLBACK_FULL_ROWS,
  DAEMON_SCROLLBACK_TRIMMED_PARKED_ROWS
} from './daemon-scrollback-retention'

const CAP = DAEMON_PARKED_FULL_DEPTH_CAP

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

describe('TerminalHost scrollback retention', () => {
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

  async function create(sessionId: string): Promise<symbol> {
    const result = await host.createOrAttach({
      sessionId,
      cols: 80,
      rows: 24,
      streamClient: { onData: vi.fn(), onExit: vi.fn() }
    })
    return result.attachToken
  }

  /** Latest depth applied to each emulator instance, in creation order. */
  function latestDepths(): number[] {
    const byEmulator = new Map<unknown, number>()
    for (let i = 0; i < applyRows.mock.calls.length; i += 1) {
      byEmulator.set(applyRows.mock.instances[i], applyRows.mock.calls[i][0] as number)
    }
    return [...byEmulator.values()]
  }

  it('keeps every session at full depth while parked sessions fit the cap', async () => {
    for (let i = 0; i < CAP; i += 1) {
      const token = await create(`session-${i}`)
      host.detach(`session-${i}`, token)
    }
    const depths = latestDepths()
    expect(depths).toHaveLength(CAP)
    expect(new Set(depths)).toEqual(new Set([DAEMON_SCROLLBACK_FULL_ROWS]))
  })

  it('trims only the least-recently-viewed parked sessions past the cap', async () => {
    const OVER = CAP + 6
    for (let i = 0; i < OVER; i += 1) {
      const token = await create(`session-${i}`)
      host.detach(`session-${i}`, token)
    }
    const depths = latestDepths()
    expect(depths.filter((d) => d === DAEMON_SCROLLBACK_TRIMMED_PARKED_ROWS)).toHaveLength(
      OVER - CAP
    )
    expect(depths.filter((d) => d === DAEMON_SCROLLBACK_FULL_ROWS)).toHaveLength(CAP)
    // LRU order: the oldest sessions are the trimmed ones.
    expect(depths.slice(0, OVER - CAP)).toEqual(
      Array(OVER - CAP).fill(DAEMON_SCROLLBACK_TRIMMED_PARKED_ROWS)
    )
  })

  it('never trims a session that still has an attached client', async () => {
    await create('attached-and-viewed')
    const attachedEmulator = applyRows.mock.instances.at(-1)
    const OVER = CAP + 6
    for (let i = 0; i < OVER; i += 1) {
      const token = await create(`parked-${i}`)
      host.detach(`parked-${i}`, token)
    }
    let attachedDepth: number | undefined
    for (let i = 0; i < applyRows.mock.calls.length; i += 1) {
      if (applyRows.mock.instances[i] === attachedEmulator) {
        attachedDepth = applyRows.mock.calls[i][0] as number
      }
    }
    // The attached session is the LEAST recently created, yet keeps full depth.
    expect(attachedDepth).toBe(DAEMON_SCROLLBACK_FULL_ROWS)
  })

  it('restores full depth going forward when a trimmed session is reattached', async () => {
    const OVER = CAP + 2
    for (let i = 0; i < OVER; i += 1) {
      const token = await create(`session-${i}`)
      host.detach(`session-${i}`, token)
    }
    const firstEmulator = applyRows.mock.instances[0]
    await host.createOrAttach({
      sessionId: 'session-0',
      cols: 80,
      rows: 24,
      streamClient: { onData: vi.fn(), onExit: vi.fn() }
    })
    let latestDepth: number | undefined
    for (let i = 0; i < applyRows.mock.calls.length; i += 1) {
      if (applyRows.mock.instances[i] === firstEmulator) {
        latestDepth = applyRows.mock.calls[i][0] as number
      }
    }
    expect(latestDepth).toBe(DAEMON_SCROLLBACK_FULL_ROWS)
  })

  it('lets a freed slot return the newest trimmed session to full depth', async () => {
    const OVER = CAP + 1
    for (let i = 0; i < OVER; i += 1) {
      const token = await create(`session-${i}`)
      host.detach(`session-${i}`, token)
    }
    // Exactly one (the oldest) is trimmed; kill a full-depth session to free a slot.
    subprocesses[5]._onExitCb?.(0)
    expect(host.listSessions()).toHaveLength(OVER - 1)
    const depths = latestDepths()
    // Every remaining live session ends at full depth (the disposed one's last depth may linger).
    expect(depths.filter((d) => d === DAEMON_SCROLLBACK_FULL_ROWS).length).toBeGreaterThanOrEqual(
      OVER - 1
    )
  })
})
