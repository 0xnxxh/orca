import type { TaskStatus, DispatchStatus, DispatchContextRow } from '../../types'
import { DISPATCH_CIRCUIT_BREAK_FAILURES } from './dispatch-circuit-breaker'
import type { OrchestrationDb } from '../orchestration-db'

export function completeDispatch(this: OrchestrationDb, ctxId: string): void {
  this.db
    .prepare(
      // Why: the status guard keeps a late completion from reviving a dispatch already failed or circuit-broken.
      "UPDATE dispatch_contexts SET status = 'completed', completed_at = datetime('now'), capability_revoked_at = COALESCE(capability_revoked_at, datetime('now')) WHERE id = ? AND status IN ('pending', 'dispatched')"
    )
    .run(ctxId)
}

export function completeActiveDispatchForTask(this: OrchestrationDb, taskId: string): void {
  const active = this.db
    .prepare(
      "SELECT * FROM dispatch_contexts WHERE task_id = ? AND status IN ('pending', 'dispatched') ORDER BY rowid DESC LIMIT 1"
    )
    .get(taskId) as DispatchContextRow | undefined
  if (active) {
    this.completeDispatch(active.id)
  }
}

export function failActiveDispatchForTask(
  this: OrchestrationDb,
  taskId: string,
  error: string
): DispatchContextRow | undefined {
  const active = this.db
    .prepare(
      "SELECT * FROM dispatch_contexts WHERE task_id = ? AND status IN ('pending', 'dispatched') ORDER BY rowid DESC LIMIT 1"
    )
    .get(taskId) as DispatchContextRow | undefined
  return active ? this.failDispatch(active.id, error) : undefined
}

// Why: only bump status='dispatched' — a zombie heartbeat from a finished dispatch would mask a hung retry from the stale detector (§5.3.4).
export function recordHeartbeat(this: OrchestrationDb, dispatchId: string, at: string): void {
  this.db
    .prepare(
      "UPDATE dispatch_contexts SET last_heartbeat_at = ? WHERE id = ? AND status = 'dispatched'"
    )
    .run(at, dispatchId)
}

// Why: dispatched_at grace skips workers still within their first heartbeat interval; julianday() vs raw-TEXT compare avoids misflagging space-format timestamps as stale (#8452).
export function getStaleDispatches(
  this: OrchestrationDb,
  thresholdIso: string
): DispatchContextRow[] {
  return this.db
    .prepare(
      `SELECT * FROM dispatch_contexts
       WHERE status = 'dispatched'
         AND dispatched_at IS NOT NULL
         AND julianday(dispatched_at) < julianday(?)
         AND (last_heartbeat_at IS NULL OR julianday(last_heartbeat_at) < julianday(?))`
    )
    .all(thresholdIso, thresholdIso) as DispatchContextRow[]
}

export function failDispatch(
  this: OrchestrationDb,
  ctxId: string,
  error: string
): DispatchContextRow | undefined {
  const ctx = this.db.prepare('SELECT * FROM dispatch_contexts WHERE id = ?').get(ctxId) as
    | DispatchContextRow
    | undefined
  if (!ctx) {
    return undefined
  }

  const newFailureCount = ctx.failure_count + 1
  const newStatus: DispatchStatus =
    newFailureCount >= DISPATCH_CIRCUIT_BREAK_FAILURES ? 'circuit_broken' : 'failed'

  this.db
    .prepare(
      `UPDATE dispatch_contexts
       SET status = ?, failure_count = ?, last_failure = ?,
           completed_at = COALESCE(completed_at, datetime('now')),
           capability_revoked_at = COALESCE(capability_revoked_at, datetime('now'))
       WHERE id = ?`
    )
    .run(newStatus, newFailureCount, error, ctxId)

  // Why: back to 'ready' not 'pending' — 'pending' would strand it since promoteReadyTasks only runs when a dep completes.
  const taskStatus: TaskStatus = newStatus === 'circuit_broken' ? 'failed' : 'ready'
  // Why: the status guard keeps a late failure from reopening a task that already completed or was retried elsewhere.
  this.db
    .prepare("UPDATE tasks SET status = ? WHERE id = ? AND status IN ('dispatched', 'blocked')")
    .run(taskStatus, ctx.task_id)

  return this.db.prepare('SELECT * FROM dispatch_contexts WHERE id = ?').get(ctxId) as
    | DispatchContextRow
    | undefined
}

export type DispatchCompletionMethods = {
  completeDispatch: typeof completeDispatch
  completeActiveDispatchForTask: typeof completeActiveDispatchForTask
  failActiveDispatchForTask: typeof failActiveDispatchForTask
  recordHeartbeat: typeof recordHeartbeat
  getStaleDispatches: typeof getStaleDispatches
  failDispatch: typeof failDispatch
}

export function attachDispatchCompletion(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    completeDispatch,
    completeActiveDispatchForTask,
    failActiveDispatchForTask,
    recordHeartbeat,
    getStaleDispatches,
    failDispatch
  })
}
