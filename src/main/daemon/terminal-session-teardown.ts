import { killWithDescendantSweep } from '../pty-descendant-termination'
import { WINDOWS_PTY_JOB_DRAIN_TIMEOUT_MS } from '../windows-pty-job-control'
import type { Session } from './session'

type AgentTeardownOperation = {
  promise: Promise<void>
  immediate: boolean
  rootSignalled: boolean
  rootCompletion: Promise<void>
  session: Session
}

/** Owns agent teardown by session id until descendant termination and root
 * signalling finish, even if the Session is reaped. */
export class TerminalSessionTeardown {
  private operations = new Map<string, AgentTeardownOperation>()

  constructor(private sessions: ReadonlyMap<string, Session>) {}

  get(sessionId: string): Promise<void> | undefined {
    return this.operations.get(sessionId)?.promise
  }

  requestImmediate(sessionId: string): Promise<void> | undefined {
    const pending = this.operations.get(sessionId)
    if (pending) {
      pending.immediate = true
      if (pending.rootSignalled && pending.session.isAlive) {
        // Why: the snapshot callback may have already sent the graceful root
        // signal in this turn; an immediate join must still escalate and wait.
        pending.rootCompletion = pending.session.forceKillAndWaitForExit()
      }
    }
    return pending?.promise
  }

  killSession(sessionId: string, session: Session, immediate: boolean): void | Promise<void> {
    if (session.launchAgent) {
      return this.killAgentSession(sessionId, session, immediate)
    }
    if (immediate) {
      return session.forceKillAndWaitForExit()
    } else {
      session.kill()
    }
  }

  private killAgentSession(
    sessionId: string,
    session: Session,
    immediate: boolean
  ): void | Promise<void> {
    return this.killCoordinatedSession(sessionId, session, immediate, (killRoot, ownsRoot) => {
      if (process.platform === 'win32' && session.ownsNativeWindowsPty) {
        return this.terminateWindowsTree(session, killRoot)
      }
      return killWithDescendantSweep(session.pid, killRoot, { ownsRoot })
    })
  }

  private killCoordinatedSession(
    sessionId: string,
    session: Session,
    immediate: boolean,
    prepareRootKill: (killRoot: () => void, ownsRoot: () => boolean) => Promise<void>
  ): void | Promise<void> {
    const pending = this.operations.get(sessionId)
    if (pending) {
      // Why: an immediate caller is a stronger teardown request and must not
      // acknowledge a still-graceful root kill while capture is pending.
      pending.immediate ||= immediate
      return pending.promise
    }

    if (!session.beginTermination()) {
      // A completed graceful sweep can leave the root alive during its grace
      // window. Immediate teardown may safely escalate once no scan is pending.
      if (immediate && session.isAlive && session.isTerminating) {
        return session.forceKillAndWaitForExit()
      }
      return
    }
    if (!immediate) {
      session.scheduleForceDisposeFallback()
    }

    const entry: AgentTeardownOperation = {
      promise: Promise.resolve(),
      immediate,
      rootSignalled: false,
      rootCompletion: Promise.resolve(),
      session
    }
    const ownsRoot = (): boolean => this.sessions.get(sessionId) === session && session.isAlive
    const killRoot = (): void => {
      // Why: natural exit reaps the PID while preparation is running. Never
      // signal that stale numeric PID after this Session loses the live root.
      if (!ownsRoot()) {
        return
      }
      entry.rootSignalled = true
      if (entry.immediate) {
        entry.rootCompletion = session.forceKillAndWaitForExit()
      } else {
        session.signalTerminationRoot()
      }
    }
    const sweep = Promise.resolve(prepareRootKill(killRoot, ownsRoot))
    // Why: descendant capture completion only proves signals were requested;
    // callers must retain the native owner until OS-confirmed exit.
    const operation = sweep.then(
      () => entry.rootCompletion,
      async (preparationError: unknown) => {
        try {
          // Why: Windows failure paths still signal the root. Observe that
          // completion before rejecting so its timeout cannot escape unhandled.
          await entry.rootCompletion
        } catch (rootError) {
          throw new AggregateError(
            [preparationError, rootError],
            'Agent descendant teardown and root exit both failed'
          )
        }
        throw preparationError
      }
    )
    entry.promise = operation
    this.operations.set(sessionId, entry)
    const clearOperation = (): void => {
      if (this.operations.get(sessionId) === entry) {
        this.operations.delete(sessionId)
      }
    }
    void operation.then(clearOperation, clearOperation)
    return operation
  }

  private async terminateWindowsTree(session: Session, killRoot: () => void): Promise<void> {
    let nativeCompletion: Promise<boolean> | undefined
    try {
      nativeCompletion = session.terminateJobTree(WINDOWS_PTY_JOB_DRAIN_TIMEOUT_MS)
    } catch (error) {
      // Why: even a synchronous native bridge failure must not strand the
      // still-owned ConPTY root while destructive teardown fails closed.
      killRoot()
      throw error
    }
    if (!nativeCompletion) {
      killRoot()
      throw new Error(`Windows PTY Job ownership unavailable for process ${session.pid}`)
    }

    killRoot()
    if (!(await nativeCompletion)) {
      throw new Error(`Windows PTY Job did not drain for process ${session.pid}`)
    }
  }
}
