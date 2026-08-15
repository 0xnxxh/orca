import { isValidPtySize } from './daemon-pty-size'
import { ShellReadyBarrier } from './session-shell-ready-barrier'
import { SessionOutputPlane, type AttachedClient } from './session-output-plane'
import { ProducerPauseController } from './session-producer-pause'
import { SessionTerminationController } from './session-termination-controller'
import { SessionExitFinalizer } from './session-exit-finalizer'
import { nudgePowerShellPromptRepaint } from './windows-conpty-prompt-repaint'
import { randomUUID } from 'node:crypto'
import { PtyStartupIngress } from '../../shared/pty-startup-ingress'
import { extractOnlyCookedEchoSafeQueryReplies } from '../../shared/terminal-query-reply'
import { createPtySlaveEchoProbe } from '../../shared/pty-slave-line-discipline-echo'
import type { TuiAgent } from '../../shared/tui-agent'
import type { SessionOptions } from './session-options'
import type { SubprocessHandle } from './session-subprocess-handle'
import type {
  SessionState,
  ShellReadyState,
  TakePendingOutputResult,
  TerminalSnapshot
} from './types'

export class Session {
  readonly sessionId: string
  readonly incarnationId = randomUUID()
  readonly terminalHandle: string | null
  readonly launchAgent: TuiAgent | null
  readonly wslDistro: string | null
  private _state: SessionState = 'running'
  private _exitCode: number | null = null
  private _disposed = false
  private subprocess: SubprocessHandle
  private readonly output: SessionOutputPlane
  private readonly barrier: ShellReadyBarrier
  private readonly producerPause: ProducerPauseController
  private readonly termination: SessionTerminationController
  private readonly startupIngress: PtyStartupIngress
  private readonly exitFinalizer: SessionExitFinalizer

  constructor(opts: SessionOptions) {
    this.sessionId = opts.sessionId
    this.terminalHandle = opts.terminalHandle ?? null
    this.launchAgent = opts.launchAgent ?? null
    this.wslDistro = opts.wslDistro ?? null
    this.subprocess = opts.subprocess
    this.producerPause = new ProducerPauseController(this.subprocess)
    this.termination = new SessionTerminationController({
      sessionId: this.sessionId,
      subprocess: this.subprocess,
      launchAgent: this.launchAgent,
      getState: () => this._state,
      releaseProducerPause: (release) => this.producerPause.release(release)
    })
    // Order is load-bearing: the plane seeds history before onData is registered (below), and the
    // barrier's DA1 responder installs on the emulator the plane owns.
    this.output = new SessionOutputPlane({
      cols: opts.cols,
      rows: opts.rows,
      scrollback: opts.scrollback,
      wslDistro: opts.wslDistro,
      historySeedChunks: opts.historySeedChunks,
      filterRendererBoundOutput: (data) => this.barrier.filterRendererBoundOutput(data),
      onAllClientsDetached: () => this.producerPause.release({ resume: true })
    })
    this.barrier = new ShellReadyBarrier({
      sessionId: opts.sessionId,
      subprocess: this.subprocess,
      shellReadySupported: opts.shellReadySupported,
      shellReadyTimeoutMs: opts.shellReadyTimeoutMs,
      responderParser: this.output.responderParser,
      acceptOutput: (data) => this.startupIngress.accept(data),
      releaseFilteredQueryBytes: (pending) => this.output.releaseFilteredQueryBytes(pending)
    })
    const echoProbe = createPtySlaveEchoProbe(this.subprocess.slavePath)
    this.startupIngress = new PtyStartupIngress({
      ...(opts.startupIngress ? { intent: opts.startupIngress } : {}),
      ...(opts.ownerBackend ? { ownerBackend: opts.ownerBackend } : {}),
      write: (data) => this.subprocess.write(data),
      onEmission: (emission) => this.output.emit(emission),
      ...(echoProbe ? { echoProbe } : {})
    })
    this.exitFinalizer = new SessionExitFinalizer({
      incarnationId: this.incarnationId,
      subprocess: this.subprocess,
      output: this.output,
      barrier: this.barrier,
      producerPause: this.producerPause,
      termination: this.termination,
      startupIngress: this.startupIngress,
      onSessionExit: opts.onExit,
      getState: () => this._state,
      isDisposed: () => this._disposed,
      markDisposed: () => {
        this._disposed = true
      },
      setExitCode: (code) => {
        this._exitCode = code
      },
      markStateExited: () => {
        this._state = 'exited'
      }
    })
    this.subprocess.onData((data) => this.handleSubprocessData(data))
    this.subprocess.onExit((code) => this.exitFinalizer.handleSubprocessExit(code))
  }

  get state(): SessionState {
    return this._state
  }

  get shellState(): ShellReadyState {
    return this.barrier.state
  }

  get historySeeded(): boolean | undefined {
    return this.output.historySeeded
  }

  get exitCode(): number | null {
    return this._exitCode
  }

  get isAlive(): boolean {
    return this._state !== 'exited'
  }

  /** A viewing client is attached; a dropped transport must clear this or pause/resume semantics leak. */
  get hasAttachedClients(): boolean {
    return this.output.hasAttachedClients
  }

  get isTerminating(): boolean {
    return this.termination.isTerminating
  }

  /** Claims termination synchronously so attach/re-entry cannot race async
   * teardown preparation. Returns false when another owner already claimed it. */
  beginTermination(): boolean {
    return this.termination.beginTermination()
  }

  get pid(): number {
    return this.subprocess.pid
  }

  write(data: string): void {
    if (this._state === 'exited' || this._disposed) {
      return
    }

    // Daemon POSIX PTYs need the local provider's cooked-echo containment (#13137).
    if (
      extractOnlyCookedEchoSafeQueryReplies(data) &&
      this.startupIngress.answerLiveQueryReply(data)
    ) {
      return
    }

    // Why: keep queuing during the post-ready flush-gate window ('ready' but not yet flushed); a
    // direct write would race fresh input ahead of the buffered startup command.
    if (this.barrier.isGating) {
      this.barrier.queueInput(data)
      return
    }

    this.subprocess.write(data)
  }

  resize(cols: number, rows: number): void {
    if (this._state === 'exited' || this._disposed) {
      return
    }
    if (!isValidPtySize(cols, rows)) {
      return
    }
    this.output.resize(cols, rows)
    this.subprocess.resize(cols, rows)
  }

  /** Producer-side flow control: stop reading the PTY fd so a flooding child blocks on write.
   *  Arms the lost-resume failsafe; re-pausing re-arms it. */
  pauseProducer(): void {
    if (this._state === 'exited' || this._disposed) {
      return
    }
    this.producerPause.pause()
  }

  resumeProducer(): void {
    this.producerPause.release({ resume: true })
  }

  kill(): void {
    this.termination.kill()
  }

  /** Signals a root whose descendant snapshot has completed. */
  signalTerminationRoot(): void {
    this.termination.signalTerminationRoot()
  }

  /** Starts the graceful-kill deadline when a coordinator owns the snapshot-first portion of teardown. */
  scheduleForceDisposeFallback(): void {
    this.termination.scheduleForceDisposeFallback()
  }

  async forceKillAndWaitForExit(timeoutMs?: number): Promise<void> {
    await this.termination.forceKillAndWaitForExit(timeoutMs)
  }

  signal(sig: string): void {
    if (this._state === 'exited') {
      return
    }
    this.subprocess.signal(sig)
  }

  attachClient(client: Omit<AttachedClient, 'token'>): symbol {
    return this.output.attachClient(client)
  }

  detachClient(token: symbol): void {
    this.output.detachClient(token)
  }

  detachAllClients(): void {
    this.output.detachAllClients()
  }

  getSnapshot(opts: { scrollbackRows?: number } = {}): TerminalSnapshot | null {
    this.startupIngress.snapshotBarrier()
    if (this._disposed) {
      return null
    }
    return this.output.getSnapshot(opts)
  }

  getPartialEscapeTailAnsi(): string {
    if (this._disposed) {
      return ''
    }
    return this.output.getPartialEscapeTailAnsi()
  }

  // Why: returns the size the PTY actually applied (emulator dims) so the renderer can detect a
  // resize dropped here (exited/disposed/invalid) instead of trusting its last-requested size.
  getAppliedSize(): { cols: number; rows: number } | null {
    if (this._disposed) {
      return null
    }
    return this.output.getAppliedSize()
  }

  /** Drains records accumulated since the last take. When includeSnapshot is set it serializes in
   *  the same turn so no PTY data lands between drain and snapshot (which would replay twice on cold restore). */
  takePendingOutput(
    includeSnapshot: boolean,
    opts: { teardownSnapshot?: boolean } = {}
  ): TakePendingOutputResult | null {
    if (this._disposed) {
      return null
    }
    const releasedHeldBytes =
      includeSnapshot && opts.teardownSnapshot === true ? this.prepareForFinalSnapshot() : ''
    const { records, overflowed, seq } = this.output.drainPendingOutput(includeSnapshot)
    return {
      records: includeSnapshot
        ? releasedHeldBytes
          ? [{ kind: 'output', data: releasedHeldBytes }]
          : []
        : records,
      ...(includeSnapshot ? { drainedRecords: records } : {}),
      seq,
      overflowed,
      snapshot: includeSnapshot ? this.getSnapshot() : null
    }
  }

  getCwd(): string | null {
    return this.output.getCwd()
  }

  getForegroundProcess(): string | null {
    return this.subprocess.getForegroundProcess()
  }

  async confirmForegroundProcess(): Promise<string | null> {
    return this.subprocess.confirmForegroundProcess?.() ?? this.subprocess.getForegroundProcess()
  }

  clearScrollback(): void {
    if (this._disposed) {
      return
    }
    this.output.clearScrollback()
    this.subprocess.clear?.()
    nudgePowerShellPromptRepaint({
      subprocess: this.subprocess,
      isStartupGating: () => this.barrier.isGating,
      isCursorOnEmptyPromptLine: () => this.output.isCursorOnEmptyPromptLine()
    })
  }

  prepareForFinalSnapshot(): string {
    const held = this.barrier.releaseHeldBytes()
    this.startupIngress.snapshotBarrier()
    return held
  }

  dispose(): void {
    this.exitFinalizer.dispose()
  }

  /** fd-release-only teardown for ALREADY-exited sessions still retained in the host map; skips
   *  SIGKILL, so callers MUST NOT use it on live sessions. */
  disposeSubprocess(): void {
    this.exitFinalizer.disposeSubprocess()
  }

  /** Orderly-shutdown path (TerminalHost.dispose()) for live sessions: force-kills the child, then
   *  synchronously frees the ptmx fd. Callers MUST check isAlive first. */
  async forceKillAndDisposeSubprocess(): Promise<void> {
    await this.exitFinalizer.forceKillAndDisposeSubprocess()
  }

  private handleSubprocessData(data: string): void {
    if (this._disposed) {
      return
    }

    const scanned = this.barrier.scanStartupOutput(data)
    this.startupIngress.accept(scanned.data)
    this.barrier.notifyPromptProbe(scanned.data)
    if (scanned.releaseDeviceAttributes) {
      this.barrier.releaseDeviceAttributes()
    }
  }

  closeStartupQueryAuthority(): number {
    return this.startupIngress.closeQueryAuthority()
  }
}
