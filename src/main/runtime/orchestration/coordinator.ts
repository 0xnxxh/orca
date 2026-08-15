import type { OrchestrationDb } from './db'
import type { MessageRow, CoordinatorStatus } from './types'
import type { CoordinatorRuntime } from './coordinator-runtime-port'
import type {
  CoordinatorContext,
  CoordinatorOptions,
  CoordinatorState,
  ResolvedCoordinatorOptions
} from './coordinator-run-context'
import {
  processDecisionGates,
  processEscalations,
  processMessages
} from './coordinator-inbox-reconciliation'
import { dispatchReadyTasks } from './coordinator-task-dispatch'

const DEFAULT_POLL_MS = 2000
const MAX_CONCURRENT_DEFAULT = 4

// Why: 10 min = documented heartbeat cadence (5 min) × 2, so one missed heartbeat is the earliest a dispatch can look stale.
const HUNG_THRESHOLD_MS = 10 * 60 * 1000

export class Coordinator {
  private db: OrchestrationDb
  private runtime: CoordinatorRuntime
  private state: CoordinatorState
  private stopped = false
  private opts: ResolvedCoordinatorOptions
  private ctx: CoordinatorContext

  constructor(db: OrchestrationDb, runtime: CoordinatorRuntime, options: CoordinatorOptions) {
    this.db = db
    this.runtime = runtime
    this.opts = {
      spec: options.spec,
      coordinatorHandle: options.coordinatorHandle,
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_MS,
      maxConcurrent: options.maxConcurrent ?? MAX_CONCURRENT_DEFAULT,
      worktree: options.worktree,
      onLog: options.onLog ?? (() => {})
    }
    this.state = {
      runId: '',
      phase: 'decomposing',
      completedTasks: [],
      failedTasks: [],
      escalations: []
    }
    // Why: same object references the class holds, so the phase modules observe and produce identical mutations.
    this.ctx = { db: this.db, runtime: this.runtime, opts: this.opts, state: this.state }
  }

  async run(): Promise<{
    runId: string
    status: CoordinatorStatus
    completedTasks: string[]
    failedTasks: string[]
    escalations: MessageRow[]
  }> {
    const run = this.db.createCoordinatorRun({
      spec: this.opts.spec,
      coordinatorHandle: this.opts.coordinatorHandle,
      pollIntervalMs: this.opts.pollIntervalMs
    })
    return this.executeLoop(run.id)
  }

  // Why: the RPC handler pre-creates the run record to return the ID immediately, so this method skips the DB insert.
  async runFromExistingRun(runId: string): Promise<{
    runId: string
    status: CoordinatorStatus
    completedTasks: string[]
    failedTasks: string[]
    escalations: MessageRow[]
  }> {
    return this.executeLoop(runId)
  }

  private async executeLoop(runId: string): Promise<{
    runId: string
    status: CoordinatorStatus
    completedTasks: string[]
    failedTasks: string[]
    escalations: MessageRow[]
  }> {
    this.state.runId = runId
    this.opts.onLog(`Coordinator run ${runId} started`)

    try {
      await this.decompose()

      while (!this.stopped) {
        const converged = await this.tick()
        if (converged) {
          break
        }
        await this.sleep(this.opts.pollIntervalMs)
      }

      // Why: an early stop leaves tasks incomplete, so the run counts as failed.
      const tasks = this.db.listTasks()
      const allDone = tasks.every((t) => t.status === 'completed' || t.status === 'failed')
      const failedTasks = [
        ...new Set([
          ...this.state.failedTasks,
          ...tasks.filter((task) => task.status === 'failed').map((task) => task.id)
        ])
      ]
      const finalStatus =
        this.stopped || failedTasks.length > 0 || !allDone ? 'failed' : 'completed'
      this.db.updateCoordinatorRun(runId, finalStatus)
      this.opts.onLog(`Coordinator run ${runId} ${finalStatus}`)

      return {
        runId,
        status: finalStatus,
        completedTasks: this.state.completedTasks,
        failedTasks,
        escalations: this.state.escalations
      }
    } catch (err) {
      this.db.updateCoordinatorRun(runId, 'failed')
      throw err
    }
  }

  stop(): void {
    this.stopped = true
  }

  // Why: decomposition isn't implemented yet — tasks must be pre-created before run(); AI-driven decomposition is a future phase.
  private async decompose(): Promise<void> {
    this.state.phase = 'decomposing'
    const existing = this.db.listTasks()
    if (existing.length === 0) {
      throw new Error(
        'No tasks found. Create tasks with orchestration.taskCreate before running the coordinator.'
      )
    }
    this.opts.onLog(`Found ${existing.length} tasks in DAG`)
    this.state.phase = 'dispatching'
  }

  private async tick(): Promise<boolean> {
    processMessages(this.ctx)
    processEscalations()
    processDecisionGates(this.ctx)
    this.warnStaleDispatches()
    await dispatchReadyTasks(this.ctx)
    return this.checkConvergence()
  }

  // Why: warn only, never auto-fail — a false positive (slow but correct worker) costs more than a false negative (hung worker holding a slot); see R6 of DESIGN_DOC_PREAMBLE_FIX.md.
  private warnStaleDispatches(): void {
    const thresholdIso = new Date(Date.now() - HUNG_THRESHOLD_MS).toISOString()
    const stale = this.db.getStaleDispatches(thresholdIso)
    for (const ctx of stale) {
      const minutes = Math.round(HUNG_THRESHOLD_MS / 60000)
      this.opts.onLog(
        `Warning: worker ${ctx.assignee_handle ?? '<unknown>'} on task ${ctx.task_id} has not sent a heartbeat in ~${minutes} min (dispatch ${ctx.id})`
      )
    }
  }

  private checkConvergence(): boolean {
    const tasks = this.db.listTasks()
    if (tasks.length === 0) {
      return true
    }

    const allDone = tasks.every((t) => t.status === 'completed' || t.status === 'failed')
    if (allDone) {
      this.state.phase = 'done'
      return true
    }

    // Why: no active tasks but some blocked → dependencies can never be satisfied (stuck).
    const active = tasks.filter(
      (t) => t.status === 'ready' || t.status === 'dispatched' || t.status === 'pending'
    )
    const blocked = tasks.filter((t) => t.status === 'blocked')
    if (active.length === 0 && blocked.length > 0) {
      this.opts.onLog(
        `Stuck: ${blocked.length} tasks blocked with no active tasks. Resolve decision gates to continue.`
      )
    }

    return false
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }
}
