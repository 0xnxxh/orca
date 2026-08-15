import type { PtyStartupIngress } from '../../shared/pty-startup-ingress'
import type { ProducerPauseController } from './session-producer-pause'
import type { SessionOutputPlane } from './session-output-plane'
import type { SessionTerminationController } from './session-termination-controller'
import type { ShellReadyBarrier } from './session-shell-ready-barrier'
import type { SubprocessHandle } from './session-subprocess-handle'
import type { SessionState } from './types'

export type SessionExitFinalizerOptions = {
  incarnationId: string
  subprocess: SubprocessHandle
  output: SessionOutputPlane
  barrier: ShellReadyBarrier
  producerPause: ProducerPauseController
  termination: SessionTerminationController
  startupIngress: PtyStartupIngress
  onSessionExit: ((code: number) => void) | undefined
  getState: () => SessionState
  isDisposed: () => boolean
  // The session still owns its state machine; the finalizer only asks for each flip at the point the
  // release ordering requires it.
  markDisposed: () => void
  setExitCode: (code: number) => void
  markStateExited: () => void
}

/** Once-only resource-release ordering for a session that is ending: on child exit, on dispose, and
 *  on the fd-release-only teardown shared by both. */
export class SessionExitFinalizer {
  constructor(private readonly opts: SessionExitFinalizerOptions) {}

  handleSubprocessExit(code: number): void {
    this.opts.termination.markPhysicalExit()
    if (this.opts.isDisposed()) {
      return
    }

    this.opts.barrier.handleExit()
    this.opts.startupIngress.drainAndClose()
    this.opts.setExitCode(code)
    this.opts.markStateExited()
    this.opts.termination.clearTerminating()
    // Why resume:false — the child is reaped (nothing to unblock); only the failsafe timer must not outlive the session.
    this.opts.producerPause.release({ resume: false })

    this.opts.termination.clearKillTimer()
    this.opts.barrier.clearTimers()

    // Why: release the ptmx fd here or node-pty's _socket leaks the master fd until GC (docs/fix-pty-fd-leak.md).
    // Not via teardownSubprocess: it flips `_disposed`, short-circuiting the later Session.dispose() reaper.
    this.opts.termination.disposeSubprocessHandle()

    for (const client of this.opts.output.clients) {
      client.onExit(code, this.opts.incarnationId)
    }

    // Why: hand off to the owner's reaper (disposes emulator, drops session from host map); else dead sessions accumulate.
    this.opts.onSessionExit?.(code)
  }

  dispose(): void {
    if (this.opts.isDisposed()) {
      return
    }

    // Why: `wasTerminating` below must be read BEFORE the `_state = 'exited'` flip — it guards the
    // "dispose while kill() in flight" case and the invariant needs the pre-flip `_state`; do NOT move it down.
    this.opts.barrier.releaseDeviceAttributes()
    this.opts.barrier.releaseHeldBytes()
    this.opts.startupIngress.drainAndClose()
    const wasTerminating = this.opts.termination.isTerminating && this.opts.getState() !== 'exited'
    const clientsToNotify = wasTerminating ? this.opts.output.clients.slice() : []
    if (wasTerminating) {
      try {
        this.opts.subprocess.forceKill()
      } catch {
        /* child may already be gone */
      }
      this.opts.setExitCode(-1)
      this.opts.termination.clearTerminating()
    }

    this.teardownSubprocess()
    this.opts.markStateExited()

    this.opts.output.clearClients()
    this.opts.barrier.clearQueuedInput()
    this.opts.output.dispose()

    for (const client of clientsToNotify) {
      client.onExit(-1, this.opts.incarnationId)
    }
  }

  /** fd-release-only teardown for ALREADY-exited sessions still retained in the host map; skips
   *  SIGKILL, so callers MUST NOT use it on live sessions. Separate method because a reaped pid is
   *  eligible for POSIX reuse, so SIGKILL could otherwise hit an unrelated process. */
  disposeSubprocess(): void {
    this.teardownSubprocess()
    this.opts.markStateExited()
  }

  /** Orderly-shutdown path (TerminalHost.dispose()) for live sessions: force-kills the child, then
   *  synchronously frees the ptmx fd, bypassing the 5s KILL_TIMEOUT_MS fallback. Does NOT fan out
   *  onExit (renderer reconnects cold after daemon exit). Callers MUST check isAlive first. */
  async forceKillAndDisposeSubprocess(): Promise<void> {
    // Why: daemon exit can't neutralize the native handle until a bounded retry lands and onExit proves the child was reaped.
    await this.opts.termination.forceKillAndWaitForExit()
    this.dispose()
  }

  /** Shared teardown for dispose()/forceKillAndDisposeSubprocess(). Does NOT set `_state` — the
   *  caller owns that after capturing pre-flip invariants (see the wasTerminating capture in dispose). */
  private teardownSubprocess(): void {
    if (this.opts.isDisposed()) {
      return
    }
    this.opts.markDisposed()
    // Why: never leave a paused fd behind on teardown; the handle's dead-guard makes this a no-op once the child is reaped.
    this.opts.producerPause.release({ resume: true })
    this.opts.termination.clearKillTimer()
    this.opts.barrier.dispose()
    this.opts.termination.disposeSubprocessHandle()
  }
}
