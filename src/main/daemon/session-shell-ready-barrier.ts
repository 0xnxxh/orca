import {
  installDeviceAttributesResponder,
  STARTUP_DA1_RESPONSE,
  StartupDeviceAttributesQueryFilter
} from './startup-device-attributes-responder'
import { PostReadyFlushGate } from './post-ready-flush-gate'
import {
  createShellStartupOutputScanState,
  drainShellStartupOutputScanState,
  scanShellStartupOutput,
  type ShellStartupOutputScanState
} from '../shell-startup-output-scanner'
import {
  createShellPromptReadinessProbe,
  type ShellPromptReadinessProbe
} from '../shell-prompt-readiness-probe'
import type { Terminal } from '@xterm/headless'
import type { SubprocessHandle } from './session-subprocess-handle'
import type { ShellReadyState } from './types'

const SHELL_READY_TIMEOUT_MS = 15_000
// Why: Codex skips marker-gated command delivery; this only bounds older daemon/local paths that still report shell-ready for Codex.
export const CODEX_SHELL_READY_TIMEOUT_MS = 300

export type ShellReadyBarrierOptions = {
  sessionId: string
  subprocess: SubprocessHandle
  shellReadySupported: boolean
  shellReadyTimeoutMs?: number
  /** The daemon emulator's parser, where the startup DA1 responder registers. */
  responderParser: Terminal['parser']
  /** Feeds bytes the barrier withheld back into the session's ingress. */
  acceptOutput: (data: string) => void
  /** Fans DA1-filtered bytes out to attached clients once the barrier hands DA1 back. */
  releaseFilteredQueryBytes: (pending: string) => void
}

/** The shell-startup barrier: holds stdin and startup output until the OSC 777 ready marker (or a
 *  fallback release), owning the daemon-side DA1 answer that keeps a query-gated shell from deadlocking. */
export class ShellReadyBarrier {
  private _shellState: ShellReadyState
  private readonly subprocess: SubprocessHandle
  private preReadyStdinQueue: string[] = []
  private releaseStartupDeviceAttributesResponder: (() => void) | null = null
  private startupDeviceAttributesQueryFilter: StartupDeviceAttributesQueryFilter | null = null
  private shellStartupOutputScanState: ShellStartupOutputScanState | null = null
  private shellStartupPid: number | null = null
  private shellPromptReadinessProbe: ShellPromptReadinessProbe | null = null
  private shellReadyTimer: ReturnType<typeof setTimeout> | null = null
  private readonly postReadyFlushGate: PostReadyFlushGate

  constructor(private readonly opts: ShellReadyBarrierOptions) {
    this.subprocess = opts.subprocess
    if (opts.shellReadySupported) {
      this._shellState = 'pending'
      this.shellStartupOutputScanState = createShellStartupOutputScanState()
      // Why: `write` queues everything until the ready marker, including the renderer's DA1
      // reply — and a shell that withholds its first prompt until DA1 is answered (fish) then
      // never emits the marker that would release it. Answer from the daemon, past the queue.
      this.releaseStartupDeviceAttributesResponder = installDeviceAttributesResponder({
        parser: opts.responderParser,
        response: STARTUP_DA1_RESPONSE,
        reply: (data) => this.subprocess.write(data)
      })
      this.startupDeviceAttributesQueryFilter = new StartupDeviceAttributesQueryFilter()
      this.shellReadyTimer = setTimeout(() => {
        this.onShellReadyTimeout()
      }, opts.shellReadyTimeoutMs ?? SHELL_READY_TIMEOUT_MS)
    } else {
      this._shellState = 'unsupported'
    }

    this.postReadyFlushGate = new PostReadyFlushGate(() => this.flushPreReadyQueue())
    if (this._shellState === 'pending') {
      this.shellPromptReadinessProbe = createShellPromptReadinessProbe({
        slavePath: this.subprocess.slavePath,
        shellPath: this.subprocess.shellPath,
        shellCwd: this.subprocess.shellCwd,
        shellPathEnv: this.subprocess.shellPathEnv,
        getShellPid: () => this.shellStartupPid,
        onPromptReady: () => this.onShellPromptReady()
      })
    }
  }

  get state(): ShellReadyState {
    return this._shellState
  }

  /** True while stdin must be queued: pre-marker, or inside the post-ready flush-gate window (a
   *  direct write would race fresh input ahead of the buffered startup command). */
  get isGating(): boolean {
    return this._shellState === 'pending' || this.postReadyFlushGate.isPending
  }

  queueInput(data: string): void {
    this.preReadyStdinQueue.push(data)
  }

  /** Consumes marker bytes from a fresh PTY chunk. Returns the output to forward plus whether the
   *  caller must hand DA1 back — deferred so the release lands after the chunk reaches the ingress. */
  scanStartupOutput(data: string): { data: string; releaseDeviceAttributes: boolean } {
    let releaseStartupDeviceAttributes = false
    if (this._shellState === 'pending' && this.shellStartupOutputScanState) {
      const scanned = scanShellStartupOutput(this.shellStartupOutputScanState, data)
      data = scanned.output
      if (scanned.shellPid) {
        this.shellStartupPid = scanned.shellPid
      }
      if (scanned.ready) {
        this.transitionToReady(scanned.postMarkerBytesObserved)
        releaseStartupDeviceAttributes = true
      }
    } else {
      this.postReadyFlushGate.notifyData()
    }
    return { data, releaseDeviceAttributes: releaseStartupDeviceAttributes }
  }

  notifyPromptProbe(data: string): void {
    if (this._shellState === 'pending' && data.length > 0) {
      this.shellPromptReadinessProbe?.notifyOutput(data)
    }
  }

  /** Strips startup DA1 queries the daemon already answered from renderer-bound output. */
  filterRendererBoundOutput(data: string): string {
    return this.startupDeviceAttributesQueryFilter?.accept(data) ?? data
  }

  releaseHeldBytes(): string {
    if (!this.shellStartupOutputScanState) {
      return ''
    }
    const heldBytes = drainShellStartupOutputScanState(this.shellStartupOutputScanState)
    this.shellStartupOutputScanState = null
    // Why: scanning strips marker bytes before fan-out; if readiness never completes, release any held prefix before timeout/exit discards it.
    this.opts.acceptOutput(heldBytes)
    return heldBytes
  }

  /** Hands DA1 back to the renderer once the barrier is done, however it ended. */
  releaseDeviceAttributes(): void {
    this.releaseStartupDeviceAttributesResponder?.()
    this.releaseStartupDeviceAttributesResponder = null
    const pending = this.startupDeviceAttributesQueryFilter?.release() ?? ''
    this.startupDeviceAttributesQueryFilter = null
    if (pending.length === 0) {
      return
    }
    this.opts.releaseFilteredQueryBytes(pending)
  }

  /** Startup-side release on child exit; the caller runs it before closing its ingress. */
  handleExit(): void {
    this.releaseDeviceAttributes()
    this.shellPromptReadinessProbe?.dispose()
    this.shellPromptReadinessProbe = null
    this.releaseHeldBytes()
  }

  clearTimers(): void {
    if (this.shellReadyTimer) {
      clearTimeout(this.shellReadyTimer)
      this.shellReadyTimer = null
    }
    this.postReadyFlushGate.clear()
  }

  clearQueuedInput(): void {
    this.preReadyStdinQueue = []
    this.postReadyFlushGate.clear()
  }

  dispose(): void {
    if (this.shellReadyTimer) {
      clearTimeout(this.shellReadyTimer)
      this.shellReadyTimer = null
    }
    this.shellPromptReadinessProbe?.dispose()
    this.shellPromptReadinessProbe = null
    this.shellStartupOutputScanState = null
    this.clearQueuedInput()
  }

  private transitionToReady(postMarkerBytesObserved = false): void {
    this._shellState = 'ready'
    this.shellStartupOutputScanState = null
    this.shellPromptReadinessProbe?.dispose()
    this.shellPromptReadinessProbe = null
    if (this.shellReadyTimer) {
      clearTimeout(this.shellReadyTimer)
      this.shellReadyTimer = null
    }
    if (this.preReadyStdinQueue.length === 0) {
      return
    }
    this.postReadyFlushGate.arm(postMarkerBytesObserved)
  }

  private onShellReadyTimeout(): void {
    this.shellReadyTimer = null
    if (this._shellState !== 'pending') {
      return
    }
    this._shellState = 'timed_out'
    this.shellPromptReadinessProbe?.dispose()
    this.shellPromptReadinessProbe = null
    this.releaseDeviceAttributes()
    this.releaseHeldBytes()
    this.flushPreReadyQueue()
  }

  private onShellPromptReady(): void {
    if (this._shellState !== 'pending') {
      return
    }
    console.warn(
      `[Session] ${this.opts.sessionId}: shell-ready wrapper was replaced before its marker; releasing at the identified shell prompt. OSC 133 integration may be unavailable.`
    )
    this.releaseHeldBytes()
    this.transitionToReady(true)
    this.releaseDeviceAttributes()
  }

  private flushPreReadyQueue(): void {
    const queued = this.preReadyStdinQueue
    this.preReadyStdinQueue = []
    for (const data of queued) {
      this.subprocess.write(data)
    }
  }
}
