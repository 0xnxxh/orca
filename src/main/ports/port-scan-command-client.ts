import type { Worker } from 'node:worker_threads'
import {
  PORT_SCAN_WORKER_CALL_TIMEOUT_MS,
  type PortScanCommandRequest,
  type PortScanCommandResponse
} from './port-scan-command-protocol'

// Why (#11161): a lazily spawned, unref'd worker owns port-scan process
// creation so a hooked CreateProcessW cannot stall the main process' event
// loop (CrBrowserMain). Lifecycle — FIFO one-at-a-time dispatch, per-call
// deadline from dispatch, respawn-on-fault with a consecutive-death cap, idle
// teardown, bounded queue, fail-closed — mirrors the client added for #8864 in
// src/main/ai-vault/session-scanner-opencode-sqlite-worker-client.ts.

export const IDLE_TEARDOWN_MS = 5 * 60_000
export const MAX_CONSECUTIVE_DEATHS = 3
// A scan issues at most two commands and the renderer already guards against
// overlapping ticks; anything beyond this is pile-up, not backlog.
export const MAX_QUEUED_CALLS = 8

export type PortScanWorkerFactory = () => Worker

export type PortScanCommandOutcome = {
  stdout: string
  spawnMs: number
}

/** The worker could not be started at all — distinct from a command failure. */
export class PortScanWorkerUnavailableError extends Error {}

/** The command itself overran its budget on the worker; drives scan backoff. */
export class PortScanCommandTimeout extends Error {}

type PendingCall = {
  request: PortScanCommandRequest
  resolve: (value: PortScanCommandOutcome) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout | null
}

/**
 * Main-thread bridge that runs port-scan commands on a persistent worker
 * thread. Never falls back to spawning on this thread: a build that cannot
 * provide the worker degrades port scanning rather than reintroducing the
 * main-thread hang this boundary exists to prevent.
 */
export class PortScanCommandClient {
  private worker: Worker | null = null
  private active: PendingCall | null = null
  private queue: PendingCall[] = []
  private idleTimer: NodeJS.Timeout | null = null
  private consecutiveDeaths = 0
  private nextId = 1
  private loggedWorkerUnavailable = false
  private cleanupWorkerListeners: (() => void) | null = null
  private readonly workerFactory: PortScanWorkerFactory
  private readonly callTimeoutMs: number
  private readonly log: (message: string) => void

  constructor(options: {
    workerFactory: PortScanWorkerFactory
    callTimeoutMs?: number
    log?: (message: string) => void
  }) {
    this.workerFactory = options.workerFactory
    this.callTimeoutMs = options.callTimeoutMs ?? PORT_SCAN_WORKER_CALL_TIMEOUT_MS
    this.log = options.log ?? ((message) => console.warn(message))
  }

  /**
   * Run one command on the worker and capture stdout.
   * @param command - Binary to execute.
   * @param args - Argument vector.
   * @returns stdout plus how long process creation blocked the worker.
   * @throws PortScanCommandTimeout when the command overran its budget,
   *   PortScanWorkerUnavailableError when no worker could be started.
   */
  run(command: string, args: readonly string[]): Promise<PortScanCommandOutcome> {
    return new Promise<PortScanCommandOutcome>((resolve, reject) => {
      // A fresh burst from full idle is a new scan: clear a death count carried
      // from an earlier one so the respawn cap cannot drain this scan early.
      if (!this.active && this.queue.length === 0) {
        this.consecutiveDeaths = 0
      }
      if (this.queue.length >= MAX_QUEUED_CALLS) {
        reject(new Error('Port scan command queue is full.'))
        return
      }
      this.queue.push({
        request: { id: this.nextId++, command, args },
        resolve,
        reject,
        timer: null
      })
      this.pump()
    })
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) {
      return
    }
    const worker = this.ensureWorker()
    if (!worker) {
      this.failQueuedAsUnavailable()
      return
    }
    const call = this.queue.shift()
    if (!call) {
      return
    }
    this.active = call
    this.clearIdleTimer()
    // Deadline starts at dispatch, not enqueue: a queued call must not burn its
    // budget while an earlier stalled spawn holds the worker.
    call.timer = setTimeout(() => this.onCallDeadline(call), this.callTimeoutMs)
    call.timer.unref?.()
    worker.postMessage(call.request)
  }

  private ensureWorker(): Worker | null {
    if (this.worker) {
      return this.worker
    }
    try {
      const worker = this.workerFactory()
      const onMessage = (response: PortScanCommandResponse): void => this.onMessage(response)
      const onError = (error: Error): void => this.onWorkerFault(error)
      const onExit = (code: number): void => this.onWorkerExit(code)
      worker.on('message', onMessage)
      worker.on('error', onError)
      worker.on('exit', onExit)
      this.cleanupWorkerListeners = () => {
        worker.off('message', onMessage)
        worker.off('error', onError)
        worker.off('exit', onExit)
      }
      // Never keep the app alive for a port scan.
      worker.unref?.()
      this.worker = worker
      return worker
    } catch (err) {
      // Why (#11161): never fall back to execFile on this thread. A missing or
      // mispackaged worker bundle must degrade port scanning, not restore the
      // UI freeze this boundary prevents.
      if (!this.loggedWorkerUnavailable) {
        this.loggedWorkerUnavailable = true
        this.log(
          `[workspace-ports] command worker unavailable; port scanning is disabled. ${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }
      return null
    }
  }

  private onMessage(response: PortScanCommandResponse): void {
    const call = this.active
    if (!call || call.request.id !== response.id) {
      return
    }
    this.consecutiveDeaths = 0
    if (response.ok) {
      this.settle(call, () => call.resolve({ stdout: response.stdout, spawnMs: response.spawnMs }))
    } else {
      const error = response.timedOut
        ? new PortScanCommandTimeout(response.error)
        : new Error(response.error)
      this.settle(call, () => call.reject(error))
    }
    this.afterSettle()
  }

  private onCallDeadline(call: PendingCall): void {
    if (this.active !== call) {
      return
    }
    // A worker that is this far past its budget is wedged, not slow. Treat it
    // as a fault (respawn) rather than a command timeout so the scanner does
    // not back off for something the command did not do.
    this.onWorkerFault(
      new Error(`Port scan command worker did not respond within ${this.callTimeoutMs}ms`)
    )
  }

  private onWorkerExit(code: number): void {
    // A clean self-exit is not a death, but the stale handle must be dropped or
    // the next dispatch would post into a dead worker and stall to its deadline.
    if (code === 0 && !this.active && this.queue.length === 0) {
      this.destroyWorker()
      return
    }
    this.onWorkerFault(new Error(`Port scan command worker exited with code ${code}`))
  }

  private onWorkerFault(error: Error): void {
    const failed = this.active
    this.destroyWorker()
    this.consecutiveDeaths++
    if (failed) {
      this.settle(failed, () => failed.reject(error))
    }
    if (this.consecutiveDeaths >= MAX_CONSECUTIVE_DEATHS) {
      this.drainQueueAfterCrashLoop(error)
      return
    }
    if (this.queue.length > 0) {
      this.pump()
    }
  }

  private drainQueueAfterCrashLoop(error: Error): void {
    const pending = this.queue
    this.queue = []
    this.consecutiveDeaths = 0
    const drainError = new Error(
      `Port scan command worker crashed repeatedly (${error.message}); skipping remaining commands`
    )
    for (const call of pending) {
      this.settle(call, () => call.reject(drainError))
    }
  }

  private failQueuedAsUnavailable(): void {
    const pending = this.queue
    this.queue = []
    for (const call of pending) {
      this.settle(call, () =>
        call.reject(new PortScanWorkerUnavailableError('port scan command worker spawn failed'))
      )
    }
  }

  private settle(call: PendingCall, run: () => void): void {
    if (call.timer) {
      clearTimeout(call.timer)
      call.timer = null
    }
    if (this.active === call) {
      this.active = null
    }
    run()
  }

  private afterSettle(): void {
    if (this.queue.length > 0) {
      this.pump()
    } else {
      this.scheduleIdleTeardown()
    }
  }

  private scheduleIdleTeardown(): void {
    this.clearIdleTimer()
    if (!this.worker) {
      return
    }
    // Deliberately far longer than the 30s scan cadence so a visible window
    // reuses one thread instead of recreating it every tick; in practice this
    // is the hidden-window teardown.
    this.idleTimer = setTimeout(() => this.teardownIfIdle(), IDLE_TEARDOWN_MS)
    this.idleTimer.unref?.()
  }

  private teardownIfIdle(): void {
    this.idleTimer = null
    if (this.active || this.queue.length > 0) {
      return
    }
    this.destroyWorker()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private destroyWorker(): void {
    this.clearIdleTimer()
    const worker = this.worker
    this.worker = null
    if (!worker) {
      return
    }
    this.cleanupWorkerListeners?.()
    this.cleanupWorkerListeners = null
    worker.removeAllListeners()
    void worker.terminate().catch(() => undefined)
  }
}
