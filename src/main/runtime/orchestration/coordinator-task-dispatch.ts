import { buildDispatchPreamble } from './preamble'
import type { CoordinatorContext } from './coordinator-run-context'
import type { WorktreeDrift } from './coordinator-runtime-port'
import type { TaskRow } from './types'

type TaskDispatchResult = 'dispatched' | 'stale-base-refused'

// Why (§3.1): 20 lets normal monorepo day-velocity pass but trips the 168-commit harm from ORCHESTRATOR_FEEDBACK.md (chosen in msg_eff3a646110d).
export const DISPATCH_STALE_THRESHOLD = 20

// Why (§3.4): the flag lives in the spec text (no DB column in v1); the regex is narrow so typos fail closed, and stripping keeps the infra line out of the worker's `--- TASK ---` block.
// Trade-off (§7.9): matches any spec line, even inside fenced code — fails open, but the preamble drift section still surfaces staleness to the worker.
const ALLOW_STALE_BASE_RE = /^[ \t]*allow-stale-base:[ \t]*true[ \t]*\r?$/im
const ALLOW_STALE_BASE_STRIP_RE = /^[ \t]*allow-stale-base:[ \t]*true[ \t]*\r?\n?/im

export function parseAllowStaleBaseFromSpec(spec: string): {
  allowStale: boolean
  strippedSpec: string
} {
  if (!ALLOW_STALE_BASE_RE.test(spec)) {
    return { allowStale: false, strippedSpec: spec }
  }
  const strippedSpec = spec.replace(ALLOW_STALE_BASE_STRIP_RE, '')
  return { allowStale: true, strippedSpec }
}

export async function dispatchReadyTasks(ctx: CoordinatorContext): Promise<void> {
  ctx.state.phase = 'dispatching'
  const readyTasks = ctx.db.listTasks({ ready: true })
  if (readyTasks.length === 0) {
    return
  }

  const dispatched = ctx.db.listTasks({ status: 'dispatched' })
  let slotsAvailable = ctx.opts.maxConcurrent - dispatched.length
  if (slotsAvailable <= 0) {
    return
  }

  const terminals = await getAvailableTerminals(ctx)
  if (terminals.length === 0 && slotsAvailable > 0) {
    // Why: create at most one terminal per tick to avoid spawning many at once.
    try {
      const created = await ctx.runtime.createTerminal(ctx.opts.worktree, {
        title: `Worker: ${readyTasks[0].spec.slice(0, 40)}`
      })
      terminals.push(created.handle)
      ctx.opts.onLog(`Created worker terminal ${created.handle}`)
    } catch (err) {
      ctx.opts.onLog(`Failed to create terminal: ${String(err)}`)
      return
    }
  }

  // Why: every task in one tick dispatches from the same fetched base snapshot.
  const baseDrift = ctx.opts.worktree
    ? await ctx.runtime.probeWorktreeDrift(ctx.opts.worktree).catch((err) => {
        ctx.opts.onLog(`probeWorktreeDrift failed for ${ctx.opts.worktree}: ${err}`)
        return null
      })
    : null

  for (const task of readyTasks) {
    if (slotsAvailable <= 0 || terminals.length === 0) {
      break
    }

    const targetHandle = terminals.shift()!
    slotsAvailable--

    try {
      const result = await dispatchTask(ctx, task, targetHandle, baseDrift)
      if (result === 'stale-base-refused') {
        terminals.unshift(targetHandle)
        slotsAvailable++
      }
    } catch (err) {
      ctx.opts.onLog(`Failed to dispatch task ${task.id}: ${String(err)}`)
    }
  }
}

async function dispatchTask(
  ctx: CoordinatorContext,
  task: TaskRow,
  targetHandle: string,
  baseDrift: WorktreeDrift
): Promise<TaskDispatchResult> {
  // Why (§3.1): drift check runs before createDispatchContext so a refusal doesn't bump failure_count (carried forward as MAX in db.ts:301-306) and burn the circuit-breaker budget; the task stays `ready` and retries next tick.
  const { allowStale, strippedSpec } = parseAllowStaleBaseFromSpec(task.spec)

  if (!ctx.opts.worktree) {
    // Why (§7.4): worktree is optional; with none we can't probe drift, so log that the guard is inert and proceed.
    ctx.opts.onLog(`stale-base guard inert for ${task.id}: coordinator has no worktree selector`)
  } else if (baseDrift && baseDrift.behind > DISPATCH_STALE_THRESHOLD && !allowStale) {
    // Why (§3.1): silent-return, not failDispatch — failing a recoverable stale-base here would burn the circuit-breaker budget.
    ctx.opts.onLog(
      `Skipping dispatch of ${task.id}: worktree is ${baseDrift.behind} commits ` +
        `behind ${baseDrift.base}. Pull/rebase the worktree, recreate it with ` +
        `--base-branch ${baseDrift.base}, or include 'allow-stale-base: true' ` +
        `in the task spec to override. Task remains in 'ready'; coordinator ` +
        `will retry on the next tick.`
    )
    return 'stale-base-refused'
  }

  const dispatchAuthority = ctx.runtime.getOrchestrationDispatchAuthority?.(targetHandle)
  const assigneePaneKey =
    dispatchAuthority?.paneKey ?? ctx.runtime.getTerminalPaneKey?.(targetHandle) ?? undefined
  const processIncarnation =
    dispatchAuthority?.paneKey && dispatchAuthority.processIncarnation
      ? dispatchAuthority.processIncarnation
      : undefined
  const dispatch = ctx.db.createDispatchContext(
    task.id,
    targetHandle,
    assigneePaneKey,
    dispatchAuthority?.launchTokenHash ?? undefined,
    processIncarnation
  )

  // Why: dispatched agents use orca-dev in dev mode to reach the dev runtime's socket, not production (Section 6.4).
  const preamble = buildDispatchPreamble({
    taskId: task.id,
    dispatchId: dispatch.id,
    // Why (§3.4): strippedSpec drops the allow-stale-base line so the worker doesn't read the infra flag as an instruction.
    taskSpec: strippedSpec,
    coordinatorHandle: ctx.opts.coordinatorHandle,
    workerHandle: targetHandle,
    devMode: process.env.ORCA_USER_DATA_PATH?.includes('orca-dev'),
    ...(ctx.runtime.getTerminalOrchestrationCliCommand
      ? { cliCommand: ctx.runtime.getTerminalOrchestrationCliCommand(targetHandle) }
      : {}),
    // Why (§3.2): pass baseDrift unconditionally — the preamble builder itself gates the drift section on behind > 0.
    ...(baseDrift ? { baseDrift } : {})
  })

  // Why: surface a since-resolved decision gate's outcome to the worker via the preamble.
  const gates = ctx.db.listGates({ taskId: task.id, status: 'resolved' })
  let gateContext = ''
  if (gates.length > 0) {
    const latest = gates.at(-1)!
    gateContext = `\n\n--- DECISION GATE RESOLVED ---\nQuestion: ${latest.question}\nResolution: ${latest.resolution}\n---\n`
  }

  try {
    await ctx.runtime.sendTerminalAgentPrompt(targetHandle, preamble + gateContext)
  } catch (err) {
    const updated = ctx.db.failDispatch(
      dispatch.id,
      err instanceof Error ? err.message : String(err)
    )
    if (updated?.status === 'circuit_broken') {
      ctx.state.failedTasks.push(task.id)
    }
    throw err
  }

  ctx.opts.onLog(`Dispatched task ${task.id} to ${targetHandle}`)
  ctx.state.phase = 'monitoring'
  return 'dispatched'
}

async function getAvailableTerminals(ctx: CoordinatorContext): Promise<string[]> {
  try {
    const result = await ctx.runtime.listTerminals(ctx.opts.worktree, undefined, {
      includeVisualLayouts: false
    })
    const dispatched = ctx.db.listTasks({ status: 'dispatched' })
    const busyHandles = new Set<string>()

    for (const task of dispatched) {
      const dispatchCtx = ctx.db.getDispatchContext(task.id)
      if (dispatchCtx?.assignee_handle) {
        busyHandles.add(dispatchCtx.assignee_handle)
      }
    }

    // Why: createDispatchContext's dispatch-lock guarantees correctness; this filter is only an optimization to skip busy/disconnected terminals.
    return result.terminals
      .filter(
        (t) =>
          t.handle !== ctx.opts.coordinatorHandle &&
          !busyHandles.has(t.handle) &&
          t.connected &&
          t.writable
      )
      .map((t) => t.handle)
  } catch {
    return []
  }
}
