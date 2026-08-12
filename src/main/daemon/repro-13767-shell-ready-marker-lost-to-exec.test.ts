import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Session } from './session'
import { PROMPT_READINESS_PROBE_GRACE_MS } from '../../shared/pty-prompt-readiness-probe'
import type { PtySlaveLineEditorState } from '../../shared/pty-slave-line-discipline-echo'
import type { ShellReadyState } from './types'

// Why this repro exists: an `exec` in a user rc file (Kiro CLI / Amazon Q / Fig / Warp)
// replaces the shell, dropping ZDOTDIR/--rcfile, so Orca's wrapper is never read again
// and the shell-ready marker is never printed. The barrier then waited out its full
// 15s on every spawn (#13767). The slave's line discipline still reports the prompt.

const ttyStateRef = vi.hoisted(() => ({ current: 'cooked' as PtySlaveLineEditorState }))
vi.mock('../../shared/pty-slave-line-discipline-echo', () => ({
  createPtySlaveEchoProbe: () => undefined,
  createPtySlaveLineEditorProbe: (ptsName: string | undefined) =>
    ptsName ? async () => ttyStateRef.current : undefined
}))

vi.mock('../pty-descendant-termination', () => ({ killWithDescendantSweep: vi.fn() }))

const SHELL_READY_TIMEOUT_MS = 15_000

function createMockSubprocess(slavePath: string | undefined) {
  const written: string[] = []
  let onData: ((data: string) => void) | null = null
  let onExit: ((code: number) => void) | null = null
  return {
    written,
    slavePath,
    pid: 4242,
    getForegroundProcess: () => null,
    write: (data: string) => {
      written.push(data)
    },
    resize() {},
    pause() {},
    resume() {},
    clear() {},
    kill() {},
    forceKill() {},
    signal() {},
    onData(cb: (data: string) => void) {
      onData = cb
    },
    onExit(cb: (code: number) => void) {
      onExit = cb
    },
    dispose() {},
    simulateData: (data: string) => onData?.(data),
    simulateExit: (code: number) => onExit?.(code)
  }
}

describe('#13767 — shell-ready marker stripped by an exec in user rc files', () => {
  let session: Session | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    ttyStateRef.current = 'cooked'
  })

  afterEach(() => {
    session?.dispose()
    session = null
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function createSession(slavePath: string | null = '/dev/ttys004'): {
    session: Session
    subprocess: ReturnType<typeof createMockSubprocess>
  } {
    const subprocess = createMockSubprocess(slavePath ?? undefined)
    session = new Session({
      sessionId: 'repro-13767',
      cols: 80,
      rows: 24,
      subprocess,
      shellReadySupported: true
    })
    return { session, subprocess }
  }

  it('reaches ready from the line discipline when the marker never arrives', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { session: s } = createSession()
    expect(s.shellState).toBe('pending' satisfies ShellReadyState)

    // The replacement shell draws its prompt: zle/readline clear ECHO on the slave.
    ttyStateRef.current = 'line-editor'
    await vi.advanceTimersByTimeAsync(PROMPT_READINESS_PROBE_GRACE_MS)

    expect(s.shellState).toBe('ready' satisfies ShellReadyState)
  })

  it('delivers a queued startup command instead of burning the full timeout', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { session: s, subprocess } = createSession()
    s.write('claude\r')
    expect(subprocess.written).toEqual([])

    ttyStateRef.current = 'line-editor'
    await vi.advanceTimersByTimeAsync(PROMPT_READINESS_PROBE_GRACE_MS + 100)

    expect(subprocess.written).toEqual(['claude\r'])
  })

  it('warns once that shell integration is likely inactive', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createSession()

    ttyStateRef.current = 'line-editor'
    await vi.advanceTimersByTimeAsync(PROMPT_READINESS_PROBE_GRACE_MS + 500)

    const messages = warn.mock.calls.map((call) => String(call[0]))
    expect(messages.filter((message) => message.includes('shell-ready marker'))).toHaveLength(1)
    expect(messages.join('\n')).toContain('OSC 133')
  })

  it('keeps waiting while the shell is still running its startup files', async () => {
    const { session: s } = createSession()

    // A slow rc (oh-my-zsh, nvm) leaves the slave in cooked mode until the first prompt.
    ttyStateRef.current = 'cooked'
    await vi.advanceTimersByTimeAsync(PROMPT_READINESS_PROBE_GRACE_MS + 3_000)

    expect(s.shellState).toBe('pending' satisfies ShellReadyState)
  })

  it('does not flush a startup command into a password read during startup', async () => {
    const { session: s, subprocess } = createSession()
    s.write('claude\r')

    // `read -s` in an rc file clears ECHO but stays canonical, so it reports `cooked`.
    ttyStateRef.current = 'cooked'
    await vi.advanceTimersByTimeAsync(PROMPT_READINESS_PROBE_GRACE_MS + 2_000)

    expect(s.shellState).toBe('pending' satisfies ShellReadyState)
    expect(subprocess.written).toEqual([])
  })

  it('lets the real marker win when the wrapper survived', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { session: s, subprocess } = createSession()

    s.write('claude\r')
    // Healthy wrapper: the marker lands well inside the probe's grace window.
    subprocess.simulateData('\x1b]777;orca-shell-ready\x07user@host % ')

    expect(s.shellState).toBe('ready' satisfies ShellReadyState)

    ttyStateRef.current = 'line-editor'
    await vi.advanceTimersByTimeAsync(PROMPT_READINESS_PROBE_GRACE_MS + 500)

    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain(
      'shell-ready marker never arrived'
    )
  })

  it('still times out when the slave cannot be probed', async () => {
    const { session: s } = createSession(null)

    ttyStateRef.current = 'line-editor'
    await vi.advanceTimersByTimeAsync(SHELL_READY_TIMEOUT_MS - 1)
    expect(s.shellState).toBe('pending' satisfies ShellReadyState)

    await vi.advanceTimersByTimeAsync(2)
    expect(s.shellState).toBe('timed_out' satisfies ShellReadyState)
  })
})
