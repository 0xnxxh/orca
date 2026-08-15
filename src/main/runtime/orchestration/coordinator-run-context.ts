import type { OrchestrationDb } from './db'
import type { MessageRow } from './types'
import type { CoordinatorRuntime } from './coordinator-runtime-port'

export type CoordinatorOptions = {
  spec: string
  coordinatorHandle: string
  pollIntervalMs?: number
  maxConcurrent?: number
  worktree?: string
  onLog?: (msg: string) => void
}

export type ResolvedCoordinatorOptions = Required<
  Omit<CoordinatorOptions, 'onLog' | 'worktree'>
> & {
  onLog: (msg: string) => void
  worktree?: string
}

export type CoordinatorState = {
  runId: string
  phase: 'decomposing' | 'dispatching' | 'monitoring' | 'merging' | 'done'
  completedTasks: string[]
  failedTasks: string[]
  escalations: MessageRow[]
}

// Why: the phase modules mutate the same `state`/`opts` objects the class holds, so they take live references rather than copies.
export type CoordinatorContext = {
  db: OrchestrationDb
  runtime: CoordinatorRuntime
  opts: ResolvedCoordinatorOptions
  state: CoordinatorState
}
