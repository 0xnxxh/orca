import { describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle } from './session-subprocess-handle'
import { TerminalHost } from './terminal-host'

vi.mock('../pty-descendant-termination', () => ({ killWithDescendantSweep: vi.fn() }))

function mockSubprocess(): SubprocessHandle {
  let onExitCb: ((code: number) => void) | null = null
  return {
    pid: 4242,
    getForegroundProcess: vi.fn(() => null),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => setTimeout(() => onExitCb?.(0), 1)),
    forceKill: vi.fn(() => onExitCb?.(137)),
    signal: vi.fn(),
    onData: vi.fn(),
    onExit(cb) {
      onExitCb = cb
    },
    dispose: vi.fn()
  } as unknown as SubprocessHandle
}

const streamClient = { onData: vi.fn(), onExit: vi.fn() }

function createOptions(sessionId: string) {
  return { sessionId, cols: 80, rows: 24, streamClient }
}

describe('concurrent createOrAttach across the async spawn', () => {
  it('spawns one shell when two callers race the same session id', async () => {
    // Why: cwd validation is async (STA-4470), so spawnSubprocess now suspends
    // between the "already exists?" check and the sessions.set that publishes
    // the session. Without a per-session gate both callers pass the check and
    // two shells end up hidden behind one id, which strands one of them.
    let releaseSpawn: () => void = () => {}
    const spawnGate = new Promise<void>((resolve) => {
      releaseSpawn = resolve
    })
    const spawnSubprocess = vi.fn(async () => {
      await spawnGate
      return mockSubprocess()
    })
    const host = new TerminalHost({ spawnSubprocess })

    const first = host.createOrAttach(createOptions('race-1'))
    const second = host.createOrAttach(createOptions('race-1'))
    releaseSpawn()
    const results = await Promise.all([first, second])

    expect(spawnSubprocess).toHaveBeenCalledOnce()
    expect(results.map((result) => result.isNew).sort()).toEqual([false, true])
    expect(host.listSessions()).toHaveLength(1)

    await host.dispose()
  })

  it('lets the next caller spawn after a failed spawn releases the gate', async () => {
    const spawnSubprocess = vi
      .fn<() => Promise<SubprocessHandle>>()
      .mockRejectedValueOnce(new Error('Working directory "X" does not exist.'))
      .mockImplementation(async () => mockSubprocess())
    const host = new TerminalHost({ spawnSubprocess })

    await expect(host.createOrAttach(createOptions('race-2'))).rejects.toThrow('does not exist')
    // A rejected spawn publishes nothing, so the id must stay claimable.
    await expect(host.createOrAttach(createOptions('race-2'))).resolves.toMatchObject({
      isNew: true
    })

    expect(spawnSubprocess).toHaveBeenCalledTimes(2)

    await host.dispose()
  })

  it('keeps distinct session ids spawning in parallel', async () => {
    let pendingSpawns = 0
    let maxConcurrent = 0
    const spawnSubprocess = vi.fn(async () => {
      pendingSpawns += 1
      maxConcurrent = Math.max(maxConcurrent, pendingSpawns)
      await new Promise((resolve) => setTimeout(resolve, 5))
      pendingSpawns -= 1
      return mockSubprocess()
    })
    const host = new TerminalHost({ spawnSubprocess })

    await Promise.all([
      host.createOrAttach(createOptions('solo-a')),
      host.createOrAttach(createOptions('solo-b'))
    ])

    // Why: the gate is per session id; serializing unrelated sessions would
    // rebuild the head-of-line blocking this change exists to remove.
    expect(maxConcurrent).toBe(2)

    await host.dispose()
  })
})
