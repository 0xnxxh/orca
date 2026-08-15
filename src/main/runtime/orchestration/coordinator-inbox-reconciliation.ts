import { reconcileLifecycleMessage } from './lifecycle-reconciliation'
import type { CoordinatorContext } from './coordinator-run-context'
import type { MessageRow } from './types'

export function processMessages(ctx: CoordinatorContext): void {
  const messages = ctx.db.getUnreadMessages(ctx.opts.coordinatorHandle)
  if (messages.length === 0) {
    return
  }

  for (const msg of messages) {
    switch (msg.type) {
      case 'worker_done':
        handleLifecycleMessage(ctx, msg)
        break
      case 'escalation':
        handleEscalation(ctx, msg)
        break
      case 'decision_gate':
        handleDecisionGateMessage(ctx, msg)
        break
      case 'heartbeat':
        handleLifecycleMessage(ctx, msg)
        break
      case 'status':
        ctx.opts.onLog(`Status from ${msg.from_handle}: ${msg.subject}`)
        break
      case 'dispatch':
      case 'handoff':
      case 'merge_ready':
      case 'question':
        break
    }
  }

  ctx.db.markAsRead(messages.map((m) => m.id))
}

function handleLifecycleMessage(ctx: CoordinatorContext, msg: MessageRow): void {
  const result = reconcileLifecycleMessage(ctx.db, msg, ctx.opts.onLog)
  if (result.action === 'completed') {
    if (!ctx.state.completedTasks.includes(result.taskId)) {
      ctx.state.completedTasks.push(result.taskId)
    }
    return
  }
  if (result.action === 'failed' && !ctx.state.failedTasks.includes(result.taskId)) {
    ctx.state.failedTasks.push(result.taskId)
  }
}

function handleEscalation(ctx: CoordinatorContext, msg: MessageRow): void {
  ctx.opts.onLog(`Escalation from ${msg.from_handle}: ${msg.subject}`)
  ctx.state.escalations.push(msg)

  let taskId: string | undefined
  if (msg.payload) {
    try {
      const payload = JSON.parse(msg.payload)
      taskId = payload.taskId
    } catch {
      // Escalation without structured payload — log subject as context
    }
  }

  if (!taskId) {
    return
  }

  const task = ctx.db.getTask(taskId)
  if (!task || task.status === 'completed' || task.status === 'failed') {
    return
  }

  const dispatch = ctx.db.getDispatchContext(taskId)
  if (!dispatch) {
    return
  }

  // Why: fail the dispatch to increment the circuit breaker; under threshold the task returns to 'pending' for re-dispatch next tick.
  const updated = ctx.db.failDispatch(dispatch.id, msg.subject)
  if (updated?.status === 'circuit_broken') {
    ctx.opts.onLog(`Task ${taskId} circuit broken after repeated failures`)
    ctx.db.updateTaskStatus(taskId, 'failed', `Circuit broken: ${msg.subject}`)
    ctx.state.failedTasks.push(taskId)
  } else {
    ctx.opts.onLog(`Task ${taskId} will be retried (failure ${updated?.failure_count ?? 0}/3)`)
  }
}

function handleDecisionGateMessage(ctx: CoordinatorContext, msg: MessageRow): void {
  ctx.opts.onLog(`Decision gate from ${msg.from_handle}: ${msg.subject}`)

  let payload: { taskId?: string; question?: string; options?: string[] } = {}
  if (msg.payload) {
    try {
      payload = JSON.parse(msg.payload)
    } catch {
      return
    }
  }

  if (!payload.taskId || !payload.question) {
    ctx.opts.onLog(`Warning: decision_gate missing taskId or question`)
    return
  }

  ctx.db.createGate({
    taskId: payload.taskId,
    question: payload.question,
    options: payload.options
  })

  ctx.opts.onLog(`Task ${payload.taskId} blocked on decision gate`)
}

export function processEscalations(): void {
  // Why: escalations are handled inline via handleEscalation; this stays a hook for future policies (auto-reassign, external notify).
}

export function processDecisionGates(ctx: CoordinatorContext): void {
  // Why: the coordinator never auto-resolves gates (humans do, via orchestration.gateResolve) — that would defeat them as approval checkpoints.
  const pendingGates = ctx.db.listGates({ status: 'pending' })
  for (const gate of pendingGates) {
    const task = ctx.db.getTask(gate.task_id)
    if (task && task.status !== 'blocked') {
      // Why: gate exists but task isn't blocked — re-block to restore the invariant.
      ctx.db.updateTaskStatus(gate.task_id, 'blocked')
    }
  }
}
