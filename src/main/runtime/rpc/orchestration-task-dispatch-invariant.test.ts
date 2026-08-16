import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/protocol-version'
import Database from '../../sqlite/sync-database'
import { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationDb } from '../orchestration/db'
import type { RpcRequest, RpcResponse } from './core'
import { RpcDispatcher } from './dispatcher'
import { ORCHESTRATION_METHODS } from './methods/orchestration'

const COORDINATOR_HANDLE = 'term_invariant_coordinator'
const COORDINATOR_PANE = 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WORKER_HANDLE = 'term_invariant_worker'
const WORKER_PANE = 'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const WORKER_PROCESS = 'pty-worker:incarnation-1'

type Harness = {
  db: OrchestrationDb
  dbPath: string
  dispatcher: RpcDispatcher
  runId: string
}

const harnesses: Harness[] = []
const tempDirs: string[] = []
let requestSequence = 0

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.db.close()
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Task/Dispatch state invariant', () => {
  it.each(['pending', 'dispatched'] as const)(
    'rejects a ready reset while the Dispatch is %s without mutating either row',
    async (dispatchStatus) => {
      const harness = createHarness()
      const task = harness.db.createTask({ spec: 'retain assignment', runId: harness.runId })
      const dispatch =
        dispatchStatus === 'pending'
          ? harness.db.createStartingWorkerDispatch({ taskId: task.id, startOptions: {} }).dispatch
          : await dispatchTask(harness, task.id, WORKER_HANDLE)

      const response = await updateTask(harness, task.id, 'ready', 'must not persist')

      expect(response).toMatchObject({
        ok: false,
        error: {
          code: 'task_not_startable',
          data: { taskId: task.id, dispatchId: dispatch.id }
        }
      })
      expect(readPersistedPair(harness.dbPath, task.id, dispatch.id)).toEqual({
        taskStatus: 'dispatched',
        taskResult: null,
        taskCompletedAt: null,
        dispatchStatus,
        dispatchCompletedAt: null,
        capabilityRevokedAt: null
      })
    }
  )

  it('atomically fails the active Dispatch, revokes its capability, and frees the terminal', async () => {
    const harness = createHarness()
    const task = harness.db.createTask({ spec: 'failing assignment', runId: harness.runId })
    const dispatch = await dispatchTask(harness, task.id, WORKER_HANDLE)
    const capability = harness.db.mintDispatchCapability({
      dispatchId: dispatch.id,
      paneKey: WORKER_PANE,
      processIncarnation: WORKER_PROCESS
    })

    const response = await updateTask(harness, task.id, 'failed', 'coordinator stopped work')

    expect(response).toMatchObject({ ok: true, result: { task: { status: 'failed' } } })
    expect(readPersistedPair(harness.dbPath, task.id, dispatch.id)).toMatchObject({
      taskStatus: 'failed',
      taskResult: 'coordinator stopped work',
      taskCompletedAt: expect.any(String),
      dispatchStatus: 'failed',
      dispatchCompletedAt: expect.any(String),
      capabilityRevokedAt: expect.any(String)
    })
    expect(
      harness.db.verifyDispatchCapability({
        dispatchId: dispatch.id,
        capability,
        paneKey: WORKER_PANE,
        processIncarnation: WORKER_PROCESS
      })
    ).toEqual({ valid: false, reason: `Dispatch ${dispatch.id} capability is revoked.` })

    const laterTask = harness.db.createTask({ spec: 'later assignment', runId: harness.runId })
    await expect(dispatchTask(harness, laterTask.id, WORKER_HANDLE)).resolves.toMatchObject({
      status: 'dispatched'
    })
  })

  it('preserves completed settlement and terminal reuse', async () => {
    const harness = createHarness()
    const task = harness.db.createTask({ spec: 'successful assignment', runId: harness.runId })
    const dispatch = await dispatchTask(harness, task.id, WORKER_HANDLE)

    const response = await updateTask(harness, task.id, 'completed', 'done')

    expect(response).toMatchObject({ ok: true, result: { task: { status: 'completed' } } })
    expect(readPersistedPair(harness.dbPath, task.id, dispatch.id)).toMatchObject({
      taskStatus: 'completed',
      taskResult: 'done',
      taskCompletedAt: expect.any(String),
      dispatchStatus: 'completed',
      dispatchCompletedAt: expect.any(String),
      capabilityRevokedAt: expect.any(String)
    })
    const laterTask = harness.db.createTask({ spec: 'later assignment', runId: harness.runId })
    await expect(dispatchTask(harness, laterTask.id, WORKER_HANDLE)).resolves.toMatchObject({
      status: 'dispatched'
    })
  })
})

function createHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'orca-task-dispatch-invariant-'))
  const dbPath = join(dir, 'orchestration.db')
  tempDirs.push(dir)
  const db = new OrchestrationDb(dbPath)
  const runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(db)
  vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) => {
    if (handle === COORDINATOR_HANDLE) {
      return COORDINATOR_PANE
    }
    if (handle === WORKER_HANDLE) {
      return WORKER_PANE
    }
    return null
  })
  const runId = db.createRun({
    objective: 'Enforce Task/Dispatch state',
    coordinatorHandle: COORDINATOR_HANDLE,
    coordinatorPaneKey: COORDINATOR_PANE
  }).id
  const harness = {
    db,
    dbPath,
    dispatcher: new RpcDispatcher({ runtime, methods: ORCHESTRATION_METHODS }),
    runId
  }
  harnesses.push(harness)
  return harness
}

async function dispatchTask(
  harness: Harness,
  taskId: string,
  terminalHandle: string
): Promise<{ id: string; status: string }> {
  const response = await harness.dispatcher.dispatch(
    request('orchestration.dispatch', {
      task: taskId,
      to: terminalHandle,
      from: COORDINATOR_HANDLE,
      run: harness.runId
    })
  )
  if (!response.ok) {
    throw new Error(`${response.error.code}: ${response.error.message}`)
  }
  return (response.result as { dispatch: { id: string; status: string } }).dispatch
}

function updateTask(
  harness: Harness,
  taskId: string,
  status: 'ready' | 'completed' | 'failed',
  result: string
): Promise<RpcResponse> {
  return harness.dispatcher.dispatch(
    request('orchestration.taskUpdate', {
      id: taskId,
      status,
      result,
      callerTerminalHandle: COORDINATOR_HANDLE,
      run: harness.runId
    })
  )
}

function request(method: string, params: Record<string, unknown>): RpcRequest {
  requestSequence += 1
  return {
    id: `rpc_task_dispatch_invariant_${requestSequence}`,
    authToken: 'test-token',
    method,
    params,
    orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
    orchestrationRequestId: `task_dispatch_invariant_${requestSequence}`
  }
}

function readPersistedPair(dbPath: string, taskId: string, dispatchId: string) {
  const sqlite = new Database(dbPath, { readonly: true })
  try {
    const task = sqlite
      .prepare('SELECT status, result, completed_at FROM tasks WHERE id = ?')
      .get(taskId) as { status: string; result: string | null; completed_at: string | null }
    const dispatch = sqlite
      .prepare(
        'SELECT status, completed_at, capability_revoked_at FROM dispatch_contexts WHERE id = ?'
      )
      .get(dispatchId) as {
      status: string
      completed_at: string | null
      capability_revoked_at: string | null
    }
    return {
      taskStatus: task.status,
      taskResult: task.result,
      taskCompletedAt: task.completed_at,
      dispatchStatus: dispatch.status,
      dispatchCompletedAt: dispatch.completed_at,
      capabilityRevokedAt: dispatch.capability_revoked_at
    }
  } finally {
    sqlite.close()
  }
}
