import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from './session'
import { TerminalSessionTeardown } from './terminal-session-teardown'
import { shutdownTerminalHostSessions } from './terminal-host-session-shutdown'

const killWithDescendantSweepMock = vi.hoisted(() => vi.fn())
const requestWindowsDescendantTreeTerminationMock = vi.hoisted(() => vi.fn())

vi.mock('../pty-descendant-termination', () => ({
  killWithDescendantSweep: killWithDescendantSweepMock
}))
vi.mock('../windows-pty-descendant-termination', () => ({
  requestWindowsDescendantTreeTermination: requestWindowsDescendantTreeTerminationMock,
  WINDOWS_PTY_JOB_DRAIN_TIMEOUT_MS: 8_000
}))

type MockSession = Session & {
  setAlive(value: boolean): void
  terminateJobTree: ReturnType<typeof vi.fn>
  forceKillAndWaitForExit: ReturnType<typeof vi.fn>
}

function createSession(opts: { agent?: boolean; nativeWindows?: boolean; hasJob?: boolean } = {}) {
  let alive = true
  return {
    pid: 99999,
    launchAgent: opts.agent ? 'claude' : null,
    ownsNativeWindowsPty: opts.nativeWindows === true,
    get isAlive() {
      return alive
    },
    isTerminating: false,
    beginTermination: vi.fn(() => true),
    setAlive(value: boolean) {
      alive = value
    },
    terminateJobTree: vi.fn(() => (opts.hasJob === false ? undefined : Promise.resolve(true))),
    forceKillAndWaitForExit: vi.fn(async () => undefined),
    kill: vi.fn(),
    scheduleForceDisposeFallback: vi.fn(),
    signalTerminationRoot: vi.fn()
  } as unknown as MockSession
}

describe('TerminalSessionTeardown Windows descendant termination', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  let sessions: Map<string, Session>
  let teardown: TerminalSessionTeardown

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    killWithDescendantSweepMock.mockReset()
    requestWindowsDescendantTreeTerminationMock.mockReset()
    requestWindowsDescendantTreeTerminationMock.mockResolvedValue(undefined)
    sessions = new Map()
    teardown = new TerminalSessionTeardown(sessions)
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('terminates an agent Job before force-killing its root', async () => {
    const session = createSession({ agent: true, nativeWindows: true })
    sessions.set('agent', session)

    await teardown.killSession('agent', session, true)

    expect(session.beginTermination).toHaveBeenCalledOnce()
    expect(killWithDescendantSweepMock).not.toHaveBeenCalled()
    expect(session.terminateJobTree).toHaveBeenCalledOnce()
    expect(session.terminateJobTree.mock.invocationCallOrder[0]).toBeLessThan(
      session.forceKillAndWaitForExit.mock.invocationCallOrder[0]!
    )
    expect(requestWindowsDescendantTreeTerminationMock).not.toHaveBeenCalled()
  })

  it('rejects fail-closed after closing the root when the agent Job does not drain', async () => {
    const session = createSession({ agent: true, nativeWindows: true })
    session.terminateJobTree.mockResolvedValue(false)
    sessions.set('agent', session)

    await expect(teardown.killSession('agent', session, true)).rejects.toThrow(
      'Windows PTY Job did not drain'
    )

    expect(session.forceKillAndWaitForExit).toHaveBeenCalledOnce()
    expect(teardown.get('agent')).toBeUndefined()
  })

  it('waits for root failure and retains both Windows teardown errors', async () => {
    const session = createSession({ agent: true, nativeWindows: true })
    const rootError = new Error('root exit timed out')
    session.terminateJobTree.mockRejectedValue(new Error('Job termination failed'))
    session.forceKillAndWaitForExit.mockRejectedValue(rootError)
    sessions.set('agent', session)

    const killing = teardown.killSession('agent', session, true)
    await expect(killing).rejects.toMatchObject({
      message: 'Agent descendant teardown and root exit both failed',
      errors: [expect.objectContaining({ message: 'Job termination failed' }), rootError]
    })

    expect(session.forceKillAndWaitForExit).toHaveBeenCalledOnce()
    expect(teardown.get('agent')).toBeUndefined()
  })

  it('uses taskkill before the agent root when Job assignment was unavailable', async () => {
    const session = createSession({ agent: true, nativeWindows: true, hasJob: false })
    sessions.set('agent', session)

    await expect(teardown.killSession('agent', session, true)).rejects.toThrow(
      'Windows PTY Job ownership unavailable'
    )

    expect(requestWindowsDescendantTreeTerminationMock).toHaveBeenCalledWith(99999)
    expect(requestWindowsDescendantTreeTerminationMock.mock.invocationCallOrder[0]).toBeLessThan(
      session.forceKillAndWaitForExit.mock.invocationCallOrder[0]!
    )
  })

  it('preserves native Job descendants for plain terminals', async () => {
    const normal = createSession({ nativeWindows: true })
    sessions.set('normal', normal)
    await teardown.killSession('normal', normal, true)

    expect(normal.terminateJobTree).not.toHaveBeenCalled()
  })

  it('does not signal a root that exits while taskkill is pending', async () => {
    let finishFallback!: () => void
    requestWindowsDescendantTreeTerminationMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishFallback = resolve
      })
    )
    const session = createSession({ agent: true, nativeWindows: true, hasJob: false })
    sessions.set('agent', session)

    const killing = teardown.killSession('agent', session, true)
    session.setAlive(false)
    sessions.delete('agent')
    finishFallback()
    await expect(killing).rejects.toThrow('Windows PTY Job ownership unavailable')

    expect(session.forceKillAndWaitForExit).not.toHaveBeenCalled()
  })

  it('routes daemon-wide shutdown through coordinated session teardown', async () => {
    const session = createSession({ agent: true, nativeWindows: true })
    const detachAllClients = vi.fn()
    const disposeSubprocess = vi.fn()
    Object.assign(session, { detachAllClients, disposeSubprocess })
    sessions.set('agent', session)
    const killSession = vi.fn(async () => undefined)

    await shutdownTerminalHostSessions(sessions, {
      killSession
    } as unknown as TerminalSessionTeardown)

    expect(killSession).toHaveBeenCalledWith('agent', session, true)
    expect(detachAllClients).toHaveBeenCalledOnce()
    expect(disposeSubprocess).toHaveBeenCalledOnce()
    expect(sessions.size).toBe(0)
  })
})
